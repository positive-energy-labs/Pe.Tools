using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.HostContracts;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.RevitData.Serialization;
using Pe.Revit.Parameters;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Revit.Loader;
using Pe.Revit.Loader.Documents;
using Pe.Revit.Operations;
using Pe.Revit.Takeoff;
using Pe.Revit.Tasks;
using Pe.Revit.Global.Services.Document;
using Serilog;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Pe.Revit.Global.Services.Host;

internal sealed class BridgeAgent : IDisposable {
    // Process lifetime is deliberate: replacing a socket must not discard native execution evidence.
    // TODO: Prove abandoned completion and reconnect replay in a controlled dev session; deterministic proof cannot certify native delivery.
    private static readonly BridgeRequestEvidence RequestEvidence = new();

    private readonly BridgeDocumentNotifier _documentNotifier;
    private readonly RevitTaskQueue _revitTaskQueue;
    private readonly RevitDataRequestService _revitDataRequestService;
    private readonly ScriptingBridgeMessageHandler _scriptingMessageHandler;
    private readonly Action<string?>? _onDisconnected;

    private readonly BridgeConnectionOptions _bridgeOptions;
    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly BridgeTransportSession _transportSession;
    private readonly ClientWebSocket _webSocket;
    private readonly BridgeRequestPump _pump;
    private readonly Task _readLoop;

    private readonly JsonSerializerSettings _serializerSettings = SdkOperations.Json;

    private readonly CancellationTokenSource _shutdown = new();
    private readonly ThrottleGate _throttleGate = new();
    private bool _disposed;

    public BridgeAgent(
        SettingsRuntimeRegistry moduleRegistry,
        BridgeConnectionOptions bridgeOptions,
        RevitTaskQueue revitTaskQueue,
        Action<string?>? onDisconnected = null
    ) {
        var startupStopwatch = Stopwatch.StartNew();
        var uiapp = RevitUiSession.CurrentUIApplication;
        var activeDocument = uiapp.GetActiveDocument();
        this._moduleRegistry = moduleRegistry;
        this._bridgeOptions = bridgeOptions;
        this._onDisconnected = onDisconnected;
        this._revitTaskQueue = revitTaskQueue;
        Log.Information(
            "Host bridge agent starting: BridgeUri={BridgeUri}, ConnectTimeoutMs={ConnectTimeoutMs}, ActiveDocument={ActiveDocumentTitle}, Modules={ModuleCount}",
            bridgeOptions.BridgeUri,
            bridgeOptions.ConnectTimeoutMs,
            activeDocument?.Title,
            moduleRegistry.GetModules().Count()
        );
        // The op catalog describes [FieldOptions] keys through the registered value domains.
        Pe.Revit.SettingsRuntime.Json.ValueDomains.SettingsValueDomainBootstrap.RegisterDefaults();
        var requestService = new RequestService(revitTaskQueue, this._moduleRegistry, this._throttleGate);
        this._revitDataRequestService = new RevitDataRequestService();
        this._scriptingMessageHandler = new ScriptingBridgeMessageHandler(
            () => RevitUiSession.CurrentUIApplication,
            message => Log.Information("Revit scripting notification: {Message}", message)
        );
        this._webSocket = new ClientWebSocket();
        var connectStopwatch = Stopwatch.StartNew();
        Log.Information("Host bridge agent connecting WebSocket: BridgeUri={BridgeUri}", bridgeOptions.BridgeUri);
        using (var connectTimeout = new CancellationTokenSource(bridgeOptions.ConnectTimeoutMs)) {
            this._webSocket.ConnectAsync(bridgeOptions.BridgeUri, connectTimeout.Token).GetAwaiter().GetResult();
        }

        Log.Information("Host bridge agent connected WebSocket in {ElapsedMs} ms.",
            connectStopwatch.ElapsedMilliseconds);
        this._transportSession = new BridgeTransportSession(
            this._webSocket,
            this._serializerSettings
        );
        this._pump = new BridgeRequestPump(
            this._transportSession,
            this.HandleRequestAsync,
            (message, exception) => {
                if (exception == null)
                    Log.Debug(message);
                else
                    Log.Error(exception, message);
            }
        );
        // One change subscription for every call; made here because this constructor runs in API context.
        OperationMonitor.Attach(uiapp.Application);
        var discoveredOps = OpRegistry.RegisterFromLoadedPeAssemblies();
        var boundOps = OpRegistry.Bind(
            requestService,
            this._revitDataRequestService,
            this._scriptingMessageHandler,
            this
        );
        Log.Information(
            "Host bridge agent discovered {DiscoveredOpCount} operations and bound {BoundOpCount} instance handlers.",
            discoveredOps,
            boundOps
        );
        this._documentNotifier = new BridgeDocumentNotifier(
            Global.Services.Document.DocumentTrackerAccessor.Current
                ?? throw new InvalidOperationException(
                    "Document tracker not available; AppCore.Startup must run before the bridge connects."),
            this._revitTaskQueue,
            this.BuildStateSnapshot,
            this.PublishDocumentInvalidationAsync
        );
        Log.Information("Host bridge agent created document notifier.");

        var registrationStopwatch = Stopwatch.StartNew();
        this.SendRegistrationAndAwaitAck();
        Log.Information(
            "Host bridge agent registration accepted in {ElapsedMs} ms.",
            registrationStopwatch.ElapsedMilliseconds
        );
        this._documentNotifier.InitializeSubscriptions();
        Log.Information("Host bridge agent initialized document notifier subscriptions.");
        this._readLoop = Task.Run(() => this.RunReadLoopAsync(this._shutdown.Token));
        Log.Information("Host bridge agent started read loop.");
        _ = this._documentNotifier.PublishInitialStateAsync();
        Log.Information("Host bridge agent queued initial document state publish.");

        this.IsConnected = true;
        RevitReceiptTransport.Sender = this.ForwardEventAsync;
        this.RuntimeFramework = RuntimeInformation.FrameworkDescription;
        this.RevitVersion = uiapp.Application.VersionNumber;
        Log.Information(
            "Host bridge connected in {ElapsedMs} ms: BridgeUri={BridgeUri}, RevitVersion={RevitVersion}, Runtime={RuntimeFramework}, Modules={ModuleCount}",
            startupStopwatch.ElapsedMilliseconds,
            this._bridgeOptions.BridgeUri,
            this.RevitVersion,
            this.RuntimeFramework,
            this._moduleRegistry.GetModules().Count()
        );
    }

    public bool IsConnected { get; private set; }
    public string? LastError { get; private set; }
    public string? RevitVersion { get; }
    public string? RuntimeFramework { get; }

    /// <summary>Broker-assigned session id from the registration ack — the client learns its own name.</summary>
    public string? SessionId { get; private set; }

    public void Dispose() {
        if (this._disposed)
            return;

        var disposeStopwatch = Stopwatch.StartNew();
        this._disposed = true;
        this.IsConnected = false;
        RequestEvidence.Detach(this.SendTerminalAsync);
        if (RevitReceiptTransport.Sender == this.ForwardEventAsync)
            RevitReceiptTransport.Sender = null;
        Log.Information("Host bridge disconnecting: BridgeUri={BridgeUri}", this._bridgeOptions.BridgeUri);

        try {
            _ = this.SendDisconnectAsync();
        } catch {
            // Best-effort disconnect notification only.
        }

        this._shutdown.Cancel();
        Log.Information(
            "Host bridge dispose canceled read loop token. Disposing WebSocket resources to unblock reads.");

        this.SafeDispose("document notifier", this._documentNotifier.Dispose);
        this.SafeDispose("scripting message handler", this._scriptingMessageHandler.Dispose);
        this.SafeDispose("transport session", this._transportSession.Dispose);
        this.SafeDispose("websocket", this._webSocket.Dispose);

        if (this._readLoop.IsCompleted)
            Log.Information("Host bridge read loop already exited during dispose.");
        else {
            Log.Information(
                "Host bridge dispose is not waiting on read loop completion to avoid blocking the Revit UI thread.");
        }

        this.SafeDispose("shutdown token", this._shutdown.Dispose);
        Log.Information("Host bridge dispose completed in {ElapsedMs} ms.",
            disposeStopwatch.ElapsedMilliseconds);
    }

    public RuntimeStatus GetStatus() =>
        new(
            true,
            this.IsConnected,
            this._bridgeOptions.BridgeUri.ToString(),
            this._bridgeOptions.ProcessId,
            RevitUiSession.CurrentUIApplication.GetActiveDocument() != null,
            RevitUiSession.CurrentUIApplication.GetActiveDocument()?.Title,
            this._moduleRegistry.GetModules().Count(),
            this.RevitVersion,
            this.RuntimeFramework,
            this.LastError
        );

    private async Task RunReadLoopAsync(CancellationToken cancellationToken) {
        Log.Information("Host bridge read loop entered.");
        try {
            await this._pump.RunAsync(cancellationToken).ConfigureAwait(false);
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            // Expected on shutdown.
        } catch (ObjectDisposedException) when (this._disposed || cancellationToken.IsCancellationRequested) {
            // Expected when dispose closes the WebSocket to unblock reads.
        } catch (Exception ex) {
            this.LastError = ex.Message;
            Log.Warning(ex, "Host bridge agent disconnected unexpectedly.");
        } finally {
            this.IsConnected = false;
            var disconnectReason = this.LastError ?? "Host bridge read loop exited.";
            Log.Information("Host bridge read loop exiting: BridgeUri={BridgeUri}, Disposed={Disposed}",
                this._bridgeOptions.BridgeUri, this._disposed);
            if (!this._disposed)
                this._onDisconnected?.Invoke(disconnectReason);
        }
    }

    // Handler for the pump's cancel: it lives here, not on BridgeRequestPump, because a SessionWrite takes its
    // scope in its signature and Pe.Shared.HostContracts references no Revit to name one. It runs off the Revit
    // thread and touches no document.
    [Op("op.cancel", OpSubject.None, OpTouches.Metadata,
        Does = "Signal cooperative cancellation to one in-flight bridge request, named by the requestId it was sent under. The operation stops at its next checkpoint and answers with a cancelled outcome; work already committed inside Revit is not undone, and an operation that never checks its token cannot be interrupted.",
        Title = "Cancel Bridge Request",
        Actor = OpActor.Any,
        Finds = ["cancel", "stop", "abort", "request", "timeout"],
        Tier = OpTier.Expert)]
    private Task<OpCancelData> CancelAsync(OpCancelRequest request, SessionWrite scope, CancellationToken cancellationToken) =>
        this._pump.CancelAsync(request, cancellationToken);

    private async Task HandleRequestAsync(BridgeRequest request, CancellationToken cancellationToken) {
        using var requestScope = RevitReceiptTransport.EnterRequest(request.RequestId);
        // Rooms owns the decision to stop at a checkpoint or finish its transaction. Wait for the
        // runner's actual result and send it even if Stop signalled the request during materialization.
        var settlementToken = request.OperationKey == "rooms.partition" ? CancellationToken.None : cancellationToken;
        Log.Information("Host bridge received request: OperationKey={OperationKey}, RequestId={RequestId}",
            request.OperationKey, request.RequestId);
        var startedAt = Stopwatch.GetTimestamp();
        var requestBytes = Encoding.UTF8.GetByteCount(request.PayloadJson);
        // Only Revit knows whether an edit landed, so native owns a mutation's attempt identity: one durable
        // admission per requestId before any effect. A repeat is answered from the record, never run again.
        // Begin before dispatch and before any response frame: the receipt is what makes this
        // product op recoverable with `pe-revit op result <requestId>` when the caller dies mid-flight
        // (a bridge frame reaches exactly one live socket and is gone).
        var mutation = IsMutation(request);
        var receipt = mutation
            ? await this.BeginAttemptAsync(request, cancellationToken).ConfigureAwait(false)
            : BeginOpReceipt(request);
        if (mutation && receipt is null)
            return; // Answered from the attempt record, or refused closed; it never runs.
        RequestEvidence.Begin(request.RequestId);
        var late = new TaskCompletionSource<RevitTaskResult<Task<OpRun>>>(TaskCreationOptions.RunContinuationsAsynchronously);
        var deferred = false;
        // Stays `none` only when the handler never started; once it ran, the runner's statement replaces it.
        Touched touched = new Touched.None();

        try {
            Log.Information(
                "Host bridge dispatch starting: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            if (!OpRegistry.TryGet(request.OperationKey, out var op))
                throw new InvalidOperationException($"Unsupported bridge operation '{request.OperationKey}'.");

            OpCallGate.Require(op.Definition, request.DerivedCommand, request.PayloadJson);
            OpRun ran;
            try {
                Task<OpRun> responseTask;
                if (op.Thread == OpThread.Revit) {
                    // The op gets the request's own token, never context.Cancellation: the queue disposes
                    // that per-run link when the delegate returns, and an async op (scripting.execute)
                    // returns at its first await, so op.cancel would fire a token nothing links anymore.
                    var run = await this._revitTaskQueue.RunForResult(
                        context => {
                            using var revitThreadRequest = RevitReceiptTransport.EnterRequest(request.RequestId);
                            return OpRunner.RunAsync(
                                op,
                                request.PayloadJson,
                                ResolveDocument(op, request.OpenDocumentId, context.Cancellation),
                                cancellationToken, request.DerivedCommand);
                        },
                        new RevitRunOptions { Label = op.Key },
                        settlementToken,
                        onLateCompletion: result => late.TrySetResult(result)
                    ).ConfigureAwait(false);
                    if (run.Outcome == RevitTaskOutcome.Faulted)
                        responseTask = run.GetValueOrThrow();
                    else if (!run.Ok) {
                        deferred = run.Outcome is RevitTaskOutcome.AbandonedStillRunning or RevitTaskOutcome.TimedOut;
                        if (deferred) RequestEvidence.Uncertain(request.RequestId, run.Outcome.ToString());
                        if (run.Outcome == RevitTaskOutcome.TimedOut) late.TrySetResult(run);
                        await this.WriteRevitTaskOutcomeAsync(
                            request,
                            receipt,
                            run.Outcome,
                            run.Detail,
                            startedAt,
                            requestBytes,
                            settlementToken
                        ).ConfigureAwait(false);
                        return;
                    } else
                        responseTask = run.Value!;
                } else {
                    responseTask = OpRunner.RunAsync(op, request.PayloadJson, null, cancellationToken, request.DerivedCommand);
                }
                ran = await responseTask.ConfigureAwait(false);
            } finally {
                // Cover prefix faults and early outcomes too, with a bounded wait for the final census.
                if (request.OperationKey == "scripting.execute")
                    await this._documentNotifier.RefreshAfterRunAsync(cancellationToken).ConfigureAwait(false);
            }
            touched = ran.Touched;
            if (ran.Error is not null)
                System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(ran.Error).Throw();
            var responseEnvelope = ran.Response;
            Log.Information(
                "Host bridge dispatch completed: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );

            var beforeSerialize = Stopwatch.GetTimestamp();
            var payloadJson = JsonConvert.SerializeObject(responseEnvelope, this._serializerSettings);
            var responseBytes = Encoding.UTF8.GetByteCount(payloadJson);
            var serializationMs = GetElapsedMilliseconds(beforeSerialize);
            var totalMs = GetElapsedMilliseconds(startedAt);
            var revitExecutionMs = GetElapsedMilliseconds(startedAt);

            var frame = new BridgeFrame(
                BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    request.RequestId,
                    true,
                    payloadJson,
                    null,
                    null,
                    null,
                    new PerformanceMetrics(
                        totalMs,
                        revitExecutionMs,
                        serializationMs,
                        requestBytes,
                        responseBytes
                    ),
                    op.Definition.Needs == OpNeeds.Nothing ? null : request.OpenDocumentId,
                    ran.EvidenceJson,
                    touched
                )
            );

            Log.Debug(
                "Bridge request handled: OperationKey={OperationKey}, RevitExecutionMs={RevitExecutionMs}, RequestBytes={RequestBytes}, ResponseBytes={ResponseBytes}",
                request.OperationKey,
                revitExecutionMs,
                requestBytes,
                responseBytes
            );
            Log.Information(
                "Host bridge writing response frame: OperationKey={OperationKey}, RequestId={RequestId}, ResponseBytes={ResponseBytes}",
                request.OperationKey,
                request.RequestId,
                responseBytes
            );
            await this.RespondAsync(request, receipt, BridgeWire.Verdicts.Ok, OpReceiptResponse.Ok(
                new JRaw(payloadJson), touched, ran.EvidenceJson is null ? null : new JRaw(ran.EvidenceJson)),
                frame, settlementToken).ConfigureAwait(false);
            Log.Information(
                "Host bridge wrote response frame: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
        } catch (OperationCanceledException cancelled) {
            // The pump owns the token, so the pump answers the cancelled frame. Here we only
            // stamp the verdict `op result` reads, then hand the pump the same touched.
            var message = request.OperationKey == "rooms.partition" && touched is Touched.None
                ? "Stopped. Nothing was written to the model."
                : $"Operation '{request.OperationKey}' was cancelled.";
            Log.Information(
                "Host bridge request cancelled: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            // The pump writes this frame; the attempt records the same one so a resend replays it.
            this.Settle(request, receipt, BridgeWire.Verdicts.Cancelled, OpReceiptResponse.Failed(
                message, BridgeOperationExceptions.CancelledStatusCode, touched),
                Refusal(request, BridgeOperationExceptions.CancelledStatusCode, "Cancelled", message, touched).Response!);
            throw new OpCancelledException(touched, cancelled, message);
        } catch (BridgeOperationException ex) {
            var totalMs = GetElapsedMilliseconds(startedAt);
            var errorFrame = new BridgeFrame(
                BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    request.RequestId,
                    false,
                    null,
                    ex.Message,
                    ex.StatusCode,
                    ex.Issues.ToList(),
                    new PerformanceMetrics(
                        totalMs,
                        totalMs,
                        0,
                        requestBytes,
                        0
                    ),
                    Touched: touched
                )
            );
            Log.Warning(
                ex,
                "Host bridge request failed with expected semantics: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            // 423 is Revit already executing something else — the op never ran, so it is `refused`,
            // not `failed`. `op result` reads the verdict; conflating them would tell an agent its
            // op broke when it was simply refused.
            var verdict = ex.StatusCode == 423 ? BridgeWire.Verdicts.Refused : BridgeWire.Verdicts.Failed;
            await this.RespondAsync(request, receipt, verdict, OpReceiptResponse.Failed(ex.Message, ex.StatusCode, touched),
                errorFrame, settlementToken).ConfigureAwait(false);
        } catch (Exception ex) {
            var totalMs = GetElapsedMilliseconds(startedAt);
            var errorFrame = new BridgeFrame(
                BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    request.RequestId,
                    false,
                    null,
                    ex.Message,
                    BridgeOperationExceptions.UnexpectedStatusCode,
                    null,
                    new PerformanceMetrics(
                        totalMs,
                        totalMs,
                        0,
                        requestBytes,
                        0
                    ),
                    Touched: touched
                )
            );
            Log.Error(
                ex,
                "Host bridge request failed: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            await this.RespondAsync(request, receipt, BridgeWire.Verdicts.Failed, OpReceiptResponse.Failed(
                ex.Message, BridgeOperationExceptions.UnexpectedStatusCode, touched), errorFrame, settlementToken).ConfigureAwait(false);
        } finally {
            if (deferred)
                _ = RequestEvidence.CompleteWhenFinishedAsync(request.RequestId, AwaitDeferredAsync(late.Task),
                    receipt is null ? null : request.RequestId);
            else
                RequestEvidence.Forget(request.RequestId);
        }
    }

    private Task SendTerminalAsync(BridgeFrame frame) => this.WriteFrameAsync(frame, CancellationToken.None);

    /// <summary>The recovered terminal: how a call that outlived its response ended, and what the runner saw it touch.</summary>
    private static async Task<(string Outcome, Touched Touched)> AwaitDeferredAsync(Task<RevitTaskResult<Task<OpRun>>> completion) {
        var result = await completion.ConfigureAwait(false);
        // The delegate yielded without a value, so nothing read the scope: what it committed first is not known.
        if (result.Outcome is RevitTaskOutcome.CancelledCooperatively or RevitTaskOutcome.CancelledBeforeDispatch or RevitTaskOutcome.TimedOut)
            return ("Cancelled", result.Outcome == RevitTaskOutcome.CancelledBeforeDispatch
                ? new Touched.None() : new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect));
        var ran = await result.GetValueOrThrow().ConfigureAwait(false);
        return (ran.Error is null ? "Succeeded" : ran.Error is OperationCanceledException ? "Cancelled" : "Failed", ran.Touched);
    }

    private async Task WriteRevitTaskOutcomeAsync(
        BridgeRequest request,
        object? receipt,
        RevitTaskOutcome outcome,
        string? detail,
        long startedAt,
        int requestBytes,
        CancellationToken cancellationToken
    ) {
        var (verdict, statusCode) = RevitTaskOutcomeResponse(outcome);
        var message = $"Revit task ended with '{verdict}' ({outcome})"
                      + (string.IsNullOrWhiteSpace(detail) ? "." : $": {detail}");
        var totalMs = GetElapsedMilliseconds(startedAt);
        // Still running or stopped part-way: the scope was never read back. Not dispatched: nothing ran.
        Touched touched = outcome is RevitTaskOutcome.TimedOut or RevitTaskOutcome.AbandonedStillRunning or RevitTaskOutcome.CancelledCooperatively
            ? new Touched.Unknown(TouchedUnknownReason.CancelledMidEffect)
            : new Touched.None();
        Log.Warning(
            "Host bridge Revit task ended without a value: OperationKey={OperationKey}, RequestId={RequestId}, Outcome={Outcome}, Verdict={Verdict}",
            request.OperationKey,
            request.RequestId,
            outcome,
            verdict
        );
        await this.RespondAsync(
            request,
            receipt,
            verdict,
            OpReceiptResponse.Failed(message, statusCode, touched, outcome.ToString()),
            new BridgeFrame(
                BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    request.RequestId,
                    false,
                    null,
                    message,
                    statusCode,
                    [BridgeOperationExceptions.Issue("$", outcome.ToString(), message, null)],
                    new PerformanceMetrics(totalMs, totalMs, 0, requestBytes, 0),
                    Touched: touched
                )
            ),
            cancellationToken
        ).ConfigureAwait(false);
    }

    private static (string Verdict, int StatusCode) RevitTaskOutcomeResponse(RevitTaskOutcome outcome) => outcome switch {
        RevitTaskOutcome.CancelledBeforeDispatch or RevitTaskOutcome.CancelledCooperatively
            => (BridgeWire.Verdicts.Cancelled, BridgeOperationExceptions.CancelledStatusCode),
        RevitTaskOutcome.TimedOut => (BridgeWire.Verdicts.TimedOut, 504),
        RevitTaskOutcome.AbandonedStillRunning => (BridgeWire.Verdicts.Abandoned, 423),
        RevitTaskOutcome.RefusedQueueUnresponsive => (BridgeWire.Verdicts.Refused, 423),
        RevitTaskOutcome.RefusedQueueDisposed => (BridgeWire.Verdicts.Refused, 503),
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Expected a non-value Revit task outcome.")
    };

    private static bool IsMutation(BridgeRequest request) =>
        OpRegistry.TryGet(request.OperationKey, out var op) && op.Definition.Effect is OpEffect.SessionWrite or OpEffect.ModelWrite;

    /// <summary>This bridge's name on an SDK <see cref="OpAttempt"/>: the door whose wire its replay bytes are in.</summary>
    private const string AttemptDoor = "pe-tools/bridge";

    /// <summary>
    /// Begins one mutation through the SDK's native attempt identity, the owner of "did this request id already
    /// run?" for every door into these ops (this bridge and the SDK's own /op/run). Returns the receipt when this
    /// dispatch may run; otherwise answers it here and returns null, and it never runs. Pe.Tools only renders the
    /// dispositions onto its own wire.
    /// </summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private async Task<object?> BeginAttemptAsync(BridgeRequest request, CancellationToken cancellationToken) {
        OpAttempt.Result attempt;
        try {
            using var process = Process.GetCurrentProcess();
            attempt = OpAttempt.Begin(request.RequestId, AttemptDoor, request.OperationKey, request.OpenDocumentId,
                request.PayloadJson, process.Id, new DateTimeOffset(process.StartTime.ToUniversalTime(), TimeSpan.Zero));
            if (attempt.Disposition == OpAttempt.Disposition.Pending)
                attempt = await OpAttempt.JoinAsync(request.RequestId, AttemptDoor, cancellationToken).ConfigureAwait(false);
        } catch (Exception ex) when (ex is not OperationCanceledException) {
            attempt = new OpAttempt.Result(OpAttempt.Disposition.Unadmitted, null, null, ex.Message);
        }
        Log.Information("Mutation attempt: OperationKey={OperationKey}, RequestId={RequestId}, Disposition={Disposition}, Detail={Detail}, Door={Door}",
            request.OperationKey, request.RequestId, attempt.Disposition, attempt.Detail, attempt.Door);
        var id = request.RequestId;
        var answer = attempt.Disposition switch {
            OpAttempt.Disposition.Admitted => null,
            OpAttempt.Disposition.Replay => new BridgeFrame(BridgeFrameKind.Response,
                Response: JsonConvert.DeserializeObject<BridgeResponse>(attempt.Response!, this._serializerSettings)),
            OpAttempt.Disposition.Conflict => Refusal(request, 409, "AttemptConflict",
                $"Request '{id}' was already dispatched for a different '{attempt.Detail}' intent; nothing ran. Send a new request id.",
                new Touched.None()),
            OpAttempt.Disposition.AnsweredElsewhere => Refusal(request, 409, "AttemptAnsweredElsewhere",
                $"Request '{id}' was already dispatched through '{attempt.Door}' and ended '{attempt.Detail}'; nothing ran here. Read its outcome there.",
                new Touched.Unknown(TouchedUnknownReason.LostResponse)),
            // The commit lived in an open instance this resend did not reach: the typed outcome (where, and whether it
            // was saved) rides as the payload, because a recorded ok is no longer the truth about the document.
            OpAttempt.Disposition.Ended => Refusal(request, 409, "AttemptEnded", attempt.Detail!,
                new Touched.Unknown(TouchedUnknownReason.ProcessExit), attempt.Ended!.ToJson()),
            OpAttempt.Disposition.Unknown => Refusal(request, 409, "AttemptOutcomeUnknown",
                $"Request '{id}' was dispatched by a Revit process that ended before it recorded an outcome; it may have committed. Read the model before sending a new request id.",
                new Touched.Unknown(TouchedUnknownReason.ProcessExit)),
            OpAttempt.Disposition.Unreceipted => Refusal(request, 503, "ReceiptUnavailable",
                $"Mutation '{request.OperationKey}' was not run: {attempt.Detail}", new Touched.None()),
            _ => Refusal(request, 503, "AdmissionUnavailable",
                $"Mutation '{request.OperationKey}' was not run: its attempt could not be durably admitted. {attempt.Detail}", new Touched.None())
        };
        if (answer is null)
            return attempt.Receipt;
        if (attempt.Disposition == OpAttempt.Disposition.Unreceipted)
            this.Settle(request, null, BridgeWire.Verdicts.Refused, null, answer.Response!);
        await this.WriteFrameAsync(answer, cancellationToken).ConfigureAwait(false);
        return null;
    }

    /// <summary>Records the terminal, then answers.</summary>
    private Task RespondAsync(BridgeRequest request, object? receipt, string verdict, OpReceiptResponse receiptResponse,
        BridgeFrame frame, CancellationToken cancellationToken) {
        this.Settle(request, receipt, verdict, receiptResponse, frame.Response!);
        return this.WriteFrameAsync(frame, cancellationToken);
    }

    /// <summary>A mutation's terminal goes to its attempt (receipt and outcome in one SDK call, the response as the
    /// replay bytes); a read's goes to its best-effort receipt only.</summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private void Settle(BridgeRequest request, object? receipt, string verdict, OpReceiptResponse? receiptResponse,
        BridgeResponse response) {
        if (!IsMutation(request)) {
            if (receiptResponse is not null)
                CompleteOpReceipt(receipt, verdict, receiptResponse);
            return;
        }
        try {
            OpAttempt.Complete(request.RequestId, AttemptDoor, (OpReceiptHandle?)receipt, verdict,
                JsonConvert.SerializeObject(response, this._serializerSettings), receiptResponse?.ToJson());
        } catch (Exception ex) {
            // Never a second run: the attempt stays pending while this Revit lives and reads unknown after it.
            Log.Warning(ex, "Mutation outcome could not be recorded: RequestId={RequestId}", request.RequestId);
        }
    }

    private static BridgeFrame Refusal(BridgeRequest request, int statusCode, string code, string message, Touched touched,
        string? payloadJson = null) =>
        new(BridgeFrameKind.Response, Response: new BridgeResponse(request.RequestId, false, payloadJson, message, statusCode,
            [BridgeOperationExceptions.Issue("$", code, message, null)], new PerformanceMetrics(0, 0, 0, 0, 0), Touched: touched));

    private static object? ResolveDocument(Op op, string? openDocumentId, CancellationToken cancellationToken) {
        cancellationToken.ThrowIfCancellationRequested();
        if (op.Definition.Needs == OpNeeds.Nothing)
            return null;

        var tracked = openDocumentId == null ? null : DocumentTrackerAccessor.Current?.FindOpenId(openDocumentId);
        var document = tracked?.Resolve()
            ?? throw BridgeOperationExceptions.Conflict("The selected document is no longer open. Select a document and retry.");
        return SdkOperations.Wrap(op.Definition.Needs, document);
    }

    /// <summary>
    /// Opens an SDK operation receipt for one product bridge READ. Best-effort: a read without a receipt
    /// is merely not recoverable through `pe-revit op result`. Mutations begin through OpAttempt instead,
    /// which fails closed.
    /// </summary>
    // OPAQUE on purpose (object, never OpReceiptHandle) and never inlined: a type reference in
    // HandleRequestAsync's state machine is resolved when THAT method is JIT-compiled, so a
    // Pe.Revit.Loader identity without the receipt types (seen 2026-08-20: TypeLoadException on
    // the first op, read loop dead, every product op 503) would take the whole request path down
    // instead of just the receipt. Here the failure lands inside the catch below.
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static object? BeginOpReceipt(BridgeRequest request) {
        try {
            using var process = Process.GetCurrentProcess();
            return OpReceipt.Begin(
                request.RequestId,
                request.OperationKey,
                process.Id,
                new DateTimeOffset(process.StartTime.ToUniversalTime(), TimeSpan.Zero)
            );
        } catch (Exception ex) {
            // A read keeps running without a receipt.
            Log.Warning(ex, "Operation receipt could not be opened for RequestId={RequestId}.", request.RequestId);
            return null;
        }
    }

    /// <summary>
    /// Writes the receipt response beside the started receipt and stamps the terminal verdict. The
    /// SDK writes a terminal record ONLY in roots where the response file already landed, so the
    /// payload goes to every receipts root first; `pe-revit op result` then answers with the real
    /// response instead of `response-missing`.
    /// </summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static void CompleteOpReceipt(object? handle, string verdict, OpReceiptResponse response) {
        if (handle is null)
            return;
        try {
            // Contract 3 (docs/features/routes/CONTRACTS.md): the one shape of this file, payload or error, with `touched`.
            var responseJson = response.ToJson();
            var receipt = (OpReceiptHandle)handle;
            string? written = null;
            foreach (var directory in SessionFiles.ReceiptDirectories()) {
                var path = Path.Combine(directory, receipt.ResponseFileName);
                try {
                    Directory.CreateDirectory(directory);
                    File.WriteAllText(path, responseJson);
                    written ??= path;
                } catch (Exception ex) {
                    Log.Warning(ex, "Operation response payload could not be written to '{ResponsePath}'.", path);
                }
            }
            if (written is not null)
                receipt.TryComplete(verdict, written);
        } catch (Exception ex) {
            Log.Warning(ex, "Operation receipt could not be completed with verdict '{Verdict}'.", verdict);
        }
    }

    private async Task PublishDocumentInvalidationAsync(DocumentInvalidationEvent payload, BridgeStateSnapshot snapshot) {
        // Cache eviction happens element-granularly in BridgeDocumentNotifier.OnDocumentChanged
        // (DocShadow.HandleChange); this path only notifies the TS host.
        if (!this.IsConnected)
            return;

        var payloadJson = JsonConvert.SerializeObject(
            payload with { RevitVersion = this.RevitVersion },
            this._serializerSettings
        );
        var frame = new BridgeFrame(
            BridgeFrameKind.Event,
            Event: new BridgeEvent(SettingsHostEventNames.DocumentChanged, payloadJson)
        );
        // Publish the API-thread snapshot before invalidation can trigger a host read.
        await this.WriteFrameAsync(new BridgeFrame(
            BridgeFrameKind.StateSync,
            StateSync: new BridgeStateSync(snapshot)
        ), this._shutdown.Token).ConfigureAwait(false);
        await this.WriteFrameAsync(frame, this._shutdown.Token).ConfigureAwait(false);
    }

    private void SendRegistrationAndAwaitAck() {
        // Session = this Revit process incarnation; this WS connection is just one attachment to it.
        // We send the raw identity tuple (pid + processStartUtc) plus selector metadata; the broker
        // derives the session id and returns it in the ack — no client-side id derivation.
        var identity = BridgeSessionIdentity.Resolve();
        Log.Information(
            "Host bridge session identity: ProcessStartUtcUnixMs={ProcessStartUtcUnixMs}, Lane={Lane}, SdkSessionId={SdkSessionId}, BuildStamp={BuildStamp}, SessionDescriptorPath={SessionDescriptorPath}",
            identity.ProcessStartUtcUnixMs,
            ProductRuntimeLayout.Current.LaneName,
            identity.SdkSessionId,
            identity.BuildStamp,
            identity.SessionDescriptorPath
        );
        var registration = new BridgeRegistrationRequest(
            BridgeProtocol.ContractVersion,
            RequestEvidence.ProcessId,
            this.BuildStateSnapshot(),
            RequestEvidence.ProcessStartUtcUnixMs,
            identity.SessionDescriptorPath,
            ProductRuntimeLayout.Current.LaneName,
            identity.SdkSessionId,
            identity.BuildStamp,
            ProductRuntimeLayout.Current.SourceRoot,
            HostEndpoint.RuntimeServiceName,
            ProductRuntimeLayout.Current.InstallRoot,
            RequestEvidence.Snapshot()
        );
        this._transportSession.Write(new BridgeFrame(
            BridgeFrameKind.Registration,
            Registration: registration
        ));

            using var timeout = new CancellationTokenSource(this._bridgeOptions.RegistrationTimeoutMs);
        var ackFrame = this._transportSession.ReadAsync(timeout.Token).GetAwaiter().GetResult();
        var ack = ackFrame?.RegistrationAck;
        if (ackFrame?.Kind != BridgeFrameKind.RegistrationAck || ack == null)
            throw new InvalidOperationException("Host did not acknowledge Revit bridge registration.");
        if (!ack.Accepted)
            throw new InvalidOperationException(ack.ErrorMessage ?? "Host rejected Revit bridge registration.");
        this.SessionId = ack.SessionId;
        _ = RequestEvidence.AttachAsync(this.SendTerminalAsync);
        Log.Information("Host bridge session registered: SessionId={SessionId}", ack.SessionId ?? "(none assigned)");
    }

    private async Task SendStateSyncAsync(CancellationToken cancellationToken) {
        if (!this._transportSession.IsConnected)
            return;

        await this.WriteFrameAsync(
            new BridgeFrame(
                BridgeFrameKind.StateSync,
                StateSync: new BridgeStateSync(this.BuildStateSnapshot())
            ),
            cancellationToken
        ).ConfigureAwait(false);
    }

    private BridgeStateSnapshot BuildStateSnapshot() {
        var activeDocument = RevitUiSession.CurrentUIApplication.GetActiveDocument();
        var tracker = DocumentTrackerAccessor.Current
            ?? throw new InvalidOperationException("Document tracker is unavailable.");
        // Title and address come from the live document, never the tracker's event-time snapshot:
        // SaveAs changes the path, and an EditFamily document is admitted before it has a title.
        var attested = true;
        // The tracker owns identity, but a LoadFamily internal close can omit lifecycle events.
        // Membership must come from Revit's current census, never retained tracker wrappers.
        var liveDocuments = RevitUiSession.CurrentUIApplication.Application.Documents
            .Cast<Autodesk.Revit.DB.Document>().ToArray();
        var documents = new List<BridgeDocumentSnapshot>();
        foreach (var tracked in tracker.Open) {
            try {
                var document = tracked.Resolve();
                if (!document.IsValidObject || !liveDocuments.Any(tracked.Matches)) {
                    Log.Warning("Host bridge skipped closed document {OpenId} retained by the SDK tracker.", tracked.OpenId);
                    continue;
                }
                if (document.IsLinked)
                    continue;
                // The SDK authority, not this payload, names the lifetime; one disagreement withholds the marker.
                attested &= PeDocumentIdentity.TryGetOpenId(document, out var authority) && authority == tracked.OpenId;
                documents.Add(CaptureDocument(document, tracked.OpenId, activeDocument != null && tracked.Matches(activeDocument)));
            } catch (Exception ex) {
                // One bad wrapper must never strand every document by preventing registration.
                Log.Warning(ex, "Host bridge could not capture document {OpenId}; skipping it.", tracked.OpenId);
            }
        }
        var runtimeAssemblies = CaptureRuntimeAssemblies();
        Log.Debug(
            "Host bridge state snapshot: ActiveDocument={ActiveDocumentTitle}",
            activeDocument?.Title
        );
        return new BridgeStateSnapshot(
            RevitUiSession.CurrentUIApplication.Application.VersionNumber,
            RuntimeInformation.FrameworkDescription,
            activeDocument != null,
            activeDocument?.Title,
            activeDocument == null ? null : activeDocument.GetDocumentKey(),
            activeDocument == null ? null : activeDocument.GetDocumentPath(),
            activeDocument?.IsFamilyDocument ?? false,
            activeDocument?.IsWorkshared ?? false,
            activeDocument?.IsModelInCloud ?? false,
            activeDocument == null ? null : activeDocument.GetCloudProjectGuid(),
            activeDocument == null ? null : activeDocument.GetCloudModelGuid(),
            activeDocument == null ? null : activeDocument.GetCloudModelUrn(),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            RevitUiSession.CurrentUIApplication.Application.SharedParametersFilename,
            documents,
            runtimeAssemblies,
            attested ? BridgeProtocol.DocumentIdentity : null
        );
    }

    internal static BridgeDocumentSnapshot CaptureDocument(Autodesk.Revit.DB.Document document, string openId, bool isActive) =>
        new(openId, document.Title, document.GetCloudModelGuid() ?? document.GetDocumentPath(), document.IsFamilyDocument, isActive,
            document.IsFamilyDocument ? null : ProjectHomePointer.Read(OwnerBlobStore.Read(document, ProjectHomePointer.Owner)).Value?.Path);

    private static List<HostRuntimeAssemblyData> CaptureRuntimeAssemblies() =>
        AppDomain.CurrentDomain.GetAssemblies()
            .Where(assembly => IsPeRuntimeAssemblyName(assembly.GetName().Name))
            .Select(CreateRuntimeAssemblyData)
            .OrderBy(assembly => assembly.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

    private static bool IsPeRuntimeAssemblyName(string? assemblyName) =>
        !string.IsNullOrWhiteSpace(assemblyName)
        && (assemblyName.StartsWith("Pe.", StringComparison.OrdinalIgnoreCase)
            || string.Equals(assemblyName, "Toon", StringComparison.OrdinalIgnoreCase));

    private static HostRuntimeAssemblyData CreateRuntimeAssemblyData(Assembly assembly) {
        var assemblyName = assembly.GetName();
        var informationalVersion = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion;
        return new HostRuntimeAssemblyData(
            assemblyName.Name ?? "unknown",
            assemblyName.Version?.ToString(),
            informationalVersion,
            string.IsNullOrWhiteSpace(assembly.Location) ? null : assembly.Location,
            assembly.ManifestModule.ModuleVersionId.ToString("D")
        );
    }

    private async Task SendDisconnectAsync() {
        if (!this._transportSession.IsConnected)
            return;

        await this.WriteFrameAsync(new BridgeFrame(
                BridgeFrameKind.Disconnect,
                DisconnectReason: "Client disconnect requested."
            ),
            CancellationToken.None).ConfigureAwait(false);
    }

    private Task WriteFrameAsync(BridgeFrame frame, CancellationToken cancellationToken) =>
        this._transportSession.WriteAsync(frame, cancellationToken);

    private async Task<bool> ForwardEventAsync(string eventName, string payloadJson, CancellationToken cancellationToken) {
        if (!this.IsConnected || Encoding.UTF8.GetByteCount(payloadJson) > 8192) return false;
        await this.WriteFrameAsync(new BridgeFrame(BridgeFrameKind.Event,
            Event: new BridgeEvent(eventName, payloadJson)), cancellationToken).ConfigureAwait(false);
        return true;
    }

    private static long GetElapsedMilliseconds(long startedTimestamp) {
        var elapsedTicks = Stopwatch.GetTimestamp() - startedTimestamp;
        return (long)(elapsedTicks * 1000.0 / Stopwatch.Frequency);
    }

    private void SafeDispose(string resourceName, Action disposeAction) {
        try {
            disposeAction();
        } catch (IOException ex) {
            Log.Warning(
                ex,
                "Host bridge dispose ignored broken I/O while disposing {ResourceName}: BridgeUri={BridgeUri}",
                resourceName,
                this._bridgeOptions.BridgeUri
            );
        } catch (ObjectDisposedException) {
            // Resource already disposed elsewhere.
        } catch (Exception ex) {
            Log.Warning(
                ex,
                "Host bridge dispose ignored unexpected failure while disposing {ResourceName}: BridgeUri={BridgeUri}",
                resourceName,
                this._bridgeOptions.BridgeUri
            );
        }
    }
}

/// <summary>Private native producer door. The connected bridge supplies host admission and process identity.</summary>
public static class RevitReceiptTransport {
    public const string EventName = "receipt.producer";
    private static readonly AsyncLocal<string?> Request = new();
    internal static Func<string, string, CancellationToken, Task<bool>>? Sender { get; set; }
    public static string? CurrentRequestId => Request.Value;

    public static Task<bool> ForwardAsync(string payloadJson, CancellationToken cancellationToken) =>
        Sender?.Invoke(EventName, payloadJson, cancellationToken) ?? Task.FromResult(false);

    internal static async Task ReportRoomsProgressAsync(RoomsPartitionProgress progress) {
        if (CurrentRequestId is not { } requestId || Sender is not { } sender) return;
        try {
            var payload = JsonConvert.SerializeObject(new { requestId, progress }, SdkOperations.Json);
            await sender("rooms.partition.progress", payload, CancellationToken.None).ConfigureAwait(false);
        } catch (Exception ex) {
            Log.Debug(ex, "Could not deliver rooms partition progress for {RequestId}", requestId);
        }
    }

    internal static IDisposable EnterRequest(string requestId) {
        var previous = Request.Value;
        Request.Value = requestId;
        return new RequestScope(previous);
    }

    private sealed class RequestScope(string? previous) : IDisposable {
        public void Dispose() => Request.Value = previous;
    }
}


internal sealed record BridgeConnectionOptions(
    Uri BridgeUri,
    int ProcessId,
    int ConnectTimeoutMs,
    int RegistrationTimeoutMs
) {
    public static BridgeConnectionOptions FromEnvironment() =>
        new(
            CreateBridgeUri(HostEndpoint.ResolveHostBaseUrl()),
            Process.GetCurrentProcess().Id,
            GetBridgeConnectTimeoutMs(),
            GetHostRegistrationTimeoutMs()
        );

    private static int GetBridgeConnectTimeoutMs() => HostRuntimeDefaults.DefaultBridgeConnectTimeoutMs;

    private static int GetHostRegistrationTimeoutMs() => HostRuntimeDefaults.DefaultHostRegistrationTimeoutMs;

    private static Uri CreateBridgeUri(string hostBaseUrl) {
        var builder = new UriBuilder(hostBaseUrl.TrimEnd('/') + HttpRoutes.Bridge) {
            Scheme = hostBaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws"
        };
        return builder.Uri;
    }
}
