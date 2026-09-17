using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.HostContracts;
using Pe.Shared.HostContracts.Transport;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Revit.Loader;
using Pe.Revit.Operations;
using Pe.Revit.Tasks;
using Pe.Revit.Global.Services.Document;
using Serilog;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Pe.Revit.Global.Services.Host;

internal sealed class BridgeAgent : IDisposable {
    private readonly BridgeDocumentNotifier _documentNotifier;
    private readonly RevitTaskQueue _revitTaskQueue;
    private readonly RevitDataRequestService _revitDataRequestService;
    private readonly ScriptingBridgeMessageHandler _scriptingMessageHandler;
    private readonly Action<string?>? _onDisconnected;

    private readonly BridgeConnectionOptions _bridgeOptions;
    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly BridgeTransportSession _transportSession;
    private readonly ClientWebSocket _webSocket;
    private readonly Task _readLoop;

    private readonly JsonSerializerSettings _serializerSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

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
        var requestService = new RequestService(revitTaskQueue, this._moduleRegistry, this._throttleGate);
        this._revitDataRequestService = new RevitDataRequestService();
        this._scriptingMessageHandler = new ScriptingBridgeMessageHandler(
            () => RevitUiSession.CurrentUIApplication,
            message => Log.Information("Revit scripting notification: {Message}", message)
        );
        var discoveredOps = OpRegistry.RegisterFromLoadedPeAssemblies();
        var boundOps = OpRegistry.Bind(
            requestService,
            this._revitDataRequestService,
            this._scriptingMessageHandler
        );
        Log.Information(
            "Host bridge agent discovered {DiscoveredOpCount} operations and bound {BoundOpCount} instance handlers.",
            discoveredOps,
            boundOps
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
        this._documentNotifier = new BridgeDocumentNotifier(
            Global.Services.Document.DocumentTrackerAccessor.Current
                ?? throw new InvalidOperationException(
                    "Document tracker not available; AppCore.Startup must run before the bridge connects."),
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
            while (!cancellationToken.IsCancellationRequested && this._transportSession.IsConnected) {
                var frame = await this._transportSession.ReadAsync(cancellationToken).ConfigureAwait(false);
                if (frame == null)
                    break;
                if (frame?.Request == null || frame.Kind != BridgeFrameKind.Request) {
                    Log.Debug("Host bridge read loop ignored frame: Kind={Kind}", frame?.Kind);
                    continue;
                }

                Log.Information("Host bridge received request: OperationKey={OperationKey}, RequestId={RequestId}",
                    frame.Request.OperationKey, frame.Request.RequestId);
                await this.HandleRequestAsync(frame.Request, cancellationToken).ConfigureAwait(false);
            }
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

    private async Task HandleRequestAsync(BridgeRequest request, CancellationToken cancellationToken) {
        var startedAt = Stopwatch.GetTimestamp();
        var requestBytes = Encoding.UTF8.GetByteCount(request.PayloadJson);
        // Begin before dispatch and before any response frame: the receipt is what makes this
        // product op recoverable with `pe-revit op result <requestId>` when the caller dies mid-flight
        // (a bridge frame reaches exactly one live socket and is gone).
        var receipt = BeginOpReceipt(request);

        try {
            Log.Information(
                "Host bridge dispatch starting: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            if (!OpRegistry.TryGet(request.OperationKey, out var op))
                throw new InvalidOperationException($"Unsupported bridge operation '{request.OperationKey}'.");

            Task<object?> responseTask;
            if (op.Thread == OpThread.Revit) {
                var run = await this._revitTaskQueue.RunForResult(
                    context => op.ExecuteAsync(
                        request.PayloadJson,
                        ResolveDocument(op, request.OpenDocumentId, context.Cancellation),
                        context.Cancellation),
                    new RevitRunOptions { Label = op.Key },
                    cancellationToken
                ).ConfigureAwait(false);
                if (run.Outcome == RevitTaskOutcome.Faulted)
                    responseTask = run.GetValueOrThrow();
                else if (!run.Ok) {
                    await this.WriteRevitTaskOutcomeAsync(
                        request,
                        receipt,
                        run.Outcome,
                        run.Detail,
                        startedAt,
                        requestBytes,
                        cancellationToken
                    ).ConfigureAwait(false);
                    return;
                } else
                    responseTask = run.Value!;
            } else {
                responseTask = op.ExecuteAsync(request.PayloadJson, null, cancellationToken);
            }

            var responseEnvelope = await responseTask.ConfigureAwait(false);
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
                    op.Definition.Needs == OpNeeds.Nothing ? null : request.OpenDocumentId
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
            CompleteOpReceipt(receipt, "ok", payloadJson);
            await this.WriteFrameAsync(frame, cancellationToken).ConfigureAwait(false);
            Log.Information(
                "Host bridge wrote response frame: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
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
                    )
                )
            );
            Log.Warning(
                ex,
                "Host bridge request failed with expected semantics: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            // 423 is Revit already executing something else — the op never ran, so it is `rejected`,
            // not `failed`. `op result` reads the verdict; conflating them would tell an agent its
            // op broke when it was simply refused.
            CompleteOpReceipt(receipt, ex.StatusCode == 423 ? "rejected" : "failed",
                JsonConvert.SerializeObject(new { error = ex.Message, statusCode = ex.StatusCode }, this._serializerSettings));
            await this.WriteFrameAsync(errorFrame, cancellationToken).ConfigureAwait(false);
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
                    )
                )
            );
            Log.Error(
                ex,
                "Host bridge request failed: OperationKey={OperationKey}, RequestId={RequestId}",
                request.OperationKey,
                request.RequestId
            );
            CompleteOpReceipt(receipt, "failed",
                JsonConvert.SerializeObject(new { error = ex.Message }, this._serializerSettings));
            await this.WriteFrameAsync(errorFrame, cancellationToken).ConfigureAwait(false);
        }
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
        var responseJson = JsonConvert.SerializeObject(
            new { error = message, statusCode, outcome = outcome.ToString(), verdict },
            this._serializerSettings
        );
        CompleteOpReceipt(receipt, verdict, responseJson);
        Log.Warning(
            "Host bridge Revit task ended without a value: OperationKey={OperationKey}, RequestId={RequestId}, Outcome={Outcome}, Verdict={Verdict}",
            request.OperationKey,
            request.RequestId,
            outcome,
            verdict
        );
        await this.WriteFrameAsync(
            new BridgeFrame(
                BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    request.RequestId,
                    false,
                    null,
                    message,
                    statusCode,
                    [BridgeOperationExceptions.Issue("$", outcome.ToString(), message, null)],
                    new PerformanceMetrics(totalMs, totalMs, 0, requestBytes, 0)
                )
            ),
            cancellationToken
        ).ConfigureAwait(false);
    }

    private static (string Verdict, int StatusCode) RevitTaskOutcomeResponse(RevitTaskOutcome outcome) => outcome switch {
        RevitTaskOutcome.CancelledBeforeDispatch or RevitTaskOutcome.CancelledCooperatively => ("cancelled", 499),
        RevitTaskOutcome.TimedOut => ("timed-out", 504),
        RevitTaskOutcome.AbandonedStillRunning => ("abandoned-still-running", 423),
        RevitTaskOutcome.RefusedQueueUnresponsive => ("rejected", 423),
        RevitTaskOutcome.RefusedQueueDisposed => ("rejected", 503),
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, "Expected a non-value Revit task outcome.")
    };

    private static object? ResolveDocument(Op op, string? openDocumentId, CancellationToken cancellationToken) {
        cancellationToken.ThrowIfCancellationRequested();
        if (op.Definition.Needs == OpNeeds.Nothing)
            return null;

        var tracked = openDocumentId == null ? null : DocumentTrackerAccessor.Current?.FindOpenId(openDocumentId);
        var document = tracked?.Resolve()
            ?? throw BridgeOperationExceptions.Conflict("The selected document is no longer open. Select a document and retry.");
        OpDocumentGate.Require(op.Definition.Needs, document != null, document?.IsFamilyDocument == true);
        return op.Definition.Needs switch {
            OpNeeds.Document => new RevitDocument(document!),
            OpNeeds.ProjectDocument => new ProjectDocument(document!),
            OpNeeds.FamilyDocument => new FamilyDocument(document!),
            _ => null
        };
    }

    /// <summary>
    /// Opens an SDK operation receipt for one product bridge request. Best-effort by construction:
    /// a receipt is diagnostics, and a diagnostics failure must never become a second Revit failure
    /// on top of the op the user actually asked for. A null handle simply means this op is not
    /// recoverable through `pe-revit op result`; every other behaviour is unchanged.
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
            // Includes the duplicate-requestId collision Begin throws on: a receipt already exists
            // for this (requestId, incarnation), so the recoverable record is there either way.
            Log.Warning(ex, "Operation receipt could not be opened for RequestId={RequestId}.", request.RequestId);
            return null;
        }
    }

    /// <summary>
    /// Writes the response payload beside the started receipt and stamps the terminal verdict. The
    /// SDK writes a terminal record ONLY in roots where the response file already landed, so the
    /// payload goes to every receipts root first; `pe-revit op result` then answers with the real
    /// response instead of `response-missing`.
    /// </summary>
    [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
    private static void CompleteOpReceipt(object? handle, string verdict, string responseJson) {
        if (handle is null)
            return;
        try {
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
            identity.Lane,
            identity.SdkSessionId,
            identity.BuildStamp,
            identity.SessionDescriptorPath
        );
        var registration = new BridgeRegistrationRequest(
            BridgeProtocol.ContractVersion,
            this._bridgeOptions.ProcessId,
            this.BuildStateSnapshot(),
            identity.ProcessStartUtcUnixMs > 0 ? identity.ProcessStartUtcUnixMs : null,
            identity.SessionDescriptorPath,
            identity.Lane,
            identity.SdkSessionId,
            identity.BuildStamp
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
        var documents = tracker.Open.Where(document => !document.IsLinked)
            .Select(document => new BridgeDocumentSnapshot(
                document.OpenId(),
                document.Title,
                document.Resolve().GetCloudModelGuid() ?? document.Path,
                document.IsFamilyDocument,
                activeDocument != null && document.Matches(activeDocument)))
            .ToList();
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
            runtimeAssemblies
        );
    }

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
