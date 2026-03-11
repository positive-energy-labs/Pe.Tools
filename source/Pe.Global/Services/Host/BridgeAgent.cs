using Newtonsoft.Json;
using Pe.Global.Revit.Utils;
using Pe.Host.Contracts;
using Pe.Global.Services.Storage.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;
using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using Pe.Global.Services.Document;

namespace Pe.Global.Services.Host;

internal sealed class BridgeAgent : IDisposable {
    private readonly ThrottleGate _throttleGate = new();
    private readonly JsonSerializerSettings _serializerSettings = BridgeJson.CreateSerializerSettings();
    private readonly BridgeDocumentNotifier _documentNotifier;
    private readonly HostConnectionOptions _hostOptions;
    private readonly RequestService _requestService;
    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly NamedPipeClientStream _pipeClient;
    private readonly StreamReader _reader;
    private readonly StreamWriter _writer;
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly CancellationTokenSource _shutdown = new();
    private readonly Task _readLoop;
    private bool _disposed;

    public BridgeAgent(
        SettingsModuleRegistry moduleRegistry,
        HostConnectionOptions hostOptions,
        RevitTaskService revitTaskService
    ) {
        var startupStopwatch = Stopwatch.StartNew();
        var uiapp = DocumentManager.uiapp;
        this._moduleRegistry = moduleRegistry;
        this._hostOptions = hostOptions;
        Log.Information(
            "Settings editor bridge agent starting: Pipe={PipeName}, ConnectTimeoutMs={ConnectTimeoutMs}, ActiveDocument={ActiveDocumentTitle}, Modules={ModuleCount}",
            hostOptions.PipeName,
            hostOptions.ConnectTimeoutMs,
            uiapp.ActiveUIDocument?.Document?.Title,
            moduleRegistry.GetModules().Count()
        );
        this._requestService = new RequestService(revitTaskService, this._moduleRegistry, this._throttleGate);

        this._pipeClient = new NamedPipeClientStream(".", hostOptions.PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        var connectStopwatch = Stopwatch.StartNew();
        Log.Information("Settings editor bridge agent connecting named pipe: Pipe={PipeName}", hostOptions.PipeName);
        this._pipeClient.Connect(hostOptions.ConnectTimeoutMs);
        Log.Information("Settings editor bridge agent connected named pipe in {ElapsedMs} ms.", connectStopwatch.ElapsedMilliseconds);
        this._reader = new StreamReader(this._pipeClient, Encoding.UTF8, false, 4096, true);
        this._writer = new StreamWriter(this._pipeClient, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        this._documentNotifier = new BridgeDocumentNotifier(this.PublishDocumentInvalidationAsync);
        Log.Information("Settings editor bridge agent created document notifier.");

        var handshakeStopwatch = Stopwatch.StartNew();
        Log.Information(
            "Settings editor bridge agent sending handshake: Modules={ModuleCount}, HasActiveDocument={HasActiveDocument}, ActiveDocument={ActiveDocumentTitle}",
            this._moduleRegistry.GetModules().Count(),
            DocumentManager.GetActiveDocument() != null,
            DocumentManager.GetActiveDocument()?.Title
        );
        this.SendHandshake();
        Log.Information("Settings editor bridge agent sent handshake in {ElapsedMs} ms.", handshakeStopwatch.ElapsedMilliseconds);
        this._documentNotifier.InitializeSubscriptions();
        Log.Information("Settings editor bridge agent initialized document notifier subscriptions.");
        this._readLoop = Task.Run(() => this.RunReadLoopAsync(this._shutdown.Token));
        Log.Information("Settings editor bridge agent started read loop.");
        _ = this._documentNotifier.PublishInitialStateAsync();
        Log.Information("Settings editor bridge agent queued initial document state publish.");

        this.IsConnected = true;
        this.RuntimeFramework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription;
        this.RevitVersion = Pe.Global.Revit.Utils.Utils.GetRevitVersion();
        Log.Information(
            "Settings editor bridge connected in {ElapsedMs} ms: Pipe={PipeName}, RevitVersion={RevitVersion}, Runtime={RuntimeFramework}, Modules={ModuleCount}",
            startupStopwatch.ElapsedMilliseconds,
            this._hostOptions.PipeName,
            this.RevitVersion,
            this.RuntimeFramework,
            this._moduleRegistry.GetModules().Count()
        );
    }

    public bool IsConnected { get; private set; }
    public string? LastError { get; private set; }
    public string? RevitVersion { get; }
    public string? RuntimeFramework { get; }

    public RuntimeStatus GetStatus() =>
        new(
            IsInitialized: true,
            IsConnected: this.IsConnected,
            PipeName: this._hostOptions.PipeName,
            HasActiveDocument: DocumentManager.GetActiveDocument() != null,
            ActiveDocumentTitle: DocumentManager.GetActiveDocument()?.Title,
            AvailableModuleCount: this._moduleRegistry.GetModules().Count(),
            RevitVersion: this.RevitVersion,
            RuntimeFramework: this.RuntimeFramework,
            LastError: this.LastError
        );

    public void Dispose() {
        if (this._disposed)
            return;

        var disposeStopwatch = Stopwatch.StartNew();
        this._disposed = true;
        this.IsConnected = false;
        Log.Information("Settings editor bridge disconnecting: Pipe={PipeName}", this._hostOptions.PipeName);

        try {
            _ = this.SendDisconnectAsync();
        } catch {
            // Best-effort disconnect notification only.
        }

        this._shutdown.Cancel();
        Log.Information("Settings editor bridge dispose canceled read loop token. Disposing pipe resources to unblock reads.");

        this.SafeDispose("document notifier", this._documentNotifier.Dispose);
        this.SafeDispose("reader", this._reader.Dispose);
        this.SafeDispose("writer", this._writer.Dispose);
        this.SafeDispose("pipe client", this._pipeClient.Dispose);

        if (this._readLoop.IsCompleted)
            Log.Information("Settings editor bridge read loop already exited during dispose.");
        else
            Log.Information("Settings editor bridge dispose is not waiting on read loop completion to avoid blocking the Revit UI thread.");

        this.SafeDispose("write lock", this._writeLock.Dispose);
        this.SafeDispose("shutdown token", this._shutdown.Dispose);
        Log.Information("Settings editor bridge dispose completed in {ElapsedMs} ms.", disposeStopwatch.ElapsedMilliseconds);
    }

    private async Task RunReadLoopAsync(CancellationToken cancellationToken) {
        Log.Information("Settings editor bridge read loop entered.");
        try {
            while (!cancellationToken.IsCancellationRequested && this._pipeClient.IsConnected) {
                var line = await this._reader.ReadLineAsync().ConfigureAwait(false);
                if (line == null)
                    break;

                var frame = JsonConvert.DeserializeObject<BridgeFrame>(line, this._serializerSettings);
                if (frame?.Request == null || frame.Kind != BridgeFrameKind.Request) {
                    Log.Debug("Settings editor bridge read loop ignored frame: Kind={Kind}", frame?.Kind);
                    continue;
                }

                Log.Information("Settings editor bridge received request: Method={Method}, RequestId={RequestId}", frame.Request.Method, frame.Request.RequestId);
                await this.HandleRequestAsync(frame.Request, cancellationToken).ConfigureAwait(false);
            }
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            // Expected on shutdown.
        } catch (ObjectDisposedException) when (this._disposed || cancellationToken.IsCancellationRequested) {
            // Expected when dispose closes the pipe to unblock ReadLineAsync.
        } catch (Exception ex) {
            this.LastError = ex.Message;
            Log.Warning(ex, "SettingsEditor bridge agent disconnected unexpectedly.");
        } finally {
            this.IsConnected = false;
            Log.Information("Settings editor bridge read loop exiting: Pipe={PipeName}, Disposed={Disposed}", this._hostOptions.PipeName, this._disposed);
        }
    }

    private async Task HandleRequestAsync(BridgeRequest request, CancellationToken cancellationToken) {
        var startedAt = Stopwatch.GetTimestamp();
        var sentAt = DateTimeOffset.FromUnixTimeMilliseconds(request.SentAtUnixMs);

        try {
            object responseEnvelope = request.Method switch {
                nameof(HubMethodNames.GetSchemaEnvelope) =>
                    await this._requestService.GetSchemaEnvelopeAsync(
                        this.DeserializePayload<SchemaRequest>(request.PayloadJson)
                    ).ConfigureAwait(false),
                nameof(HubMethodNames.ValidateSettingsEnvelope) =>
                    await this._requestService.ValidateSettingsEnvelopeAsync(
                        this.DeserializePayload<ValidateSettingsRequest>(request.PayloadJson)
                    ).ConfigureAwait(false),
                nameof(HubMethodNames.GetFieldOptionsEnvelope) =>
                    await this._requestService.GetFieldOptionsEnvelopeAsync(
                        this.DeserializePayload<FieldOptionsRequest>(request.PayloadJson)
                    ).ConfigureAwait(false),
                nameof(HubMethodNames.GetParameterCatalogEnvelope) =>
                    await this._requestService.GetParameterCatalogEnvelopeAsync(
                        this.DeserializePayload<ParameterCatalogRequest>(request.PayloadJson)
                    ).ConfigureAwait(false),
                _ => throw new InvalidOperationException($"Unsupported bridge method '{request.Method}'.")
            };

            var beforeSerialize = Stopwatch.GetTimestamp();
            var payloadJson = JsonConvert.SerializeObject(responseEnvelope, this._serializerSettings);
            var responseBytes = Encoding.UTF8.GetByteCount(payloadJson);
            var serializationMs = GetElapsedMilliseconds(beforeSerialize);
            var totalMs = (long)(DateTimeOffset.UtcNow - sentAt).TotalMilliseconds;
            var revitExecutionMs = GetElapsedMilliseconds(startedAt);

            var frame = new BridgeFrame(
                Kind: BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    RequestId: request.RequestId,
                    Ok: true,
                    PayloadJson: payloadJson,
                    ErrorMessage: null,
                    Metrics: new PerformanceMetrics(
                        RoundTripMs: totalMs,
                        RevitExecutionMs: revitExecutionMs,
                        SerializationMs: serializationMs,
                        RequestBytes: request.PayloadBytes,
                        ResponseBytes: responseBytes
                    )
                )
            );

            Log.Debug(
                "Bridge request handled: Method={Method}, RevitExecutionMs={RevitExecutionMs}, RequestBytes={RequestBytes}, ResponseBytes={ResponseBytes}",
                request.Method,
                revitExecutionMs,
                request.PayloadBytes,
                responseBytes
            );
            await this.WriteFrameAsync(frame, cancellationToken).ConfigureAwait(false);
        } catch (Exception ex) {
            var totalMs = (long)(DateTimeOffset.UtcNow - sentAt).TotalMilliseconds;
            var errorFrame = new BridgeFrame(
                Kind: BridgeFrameKind.Response,
                Response: new BridgeResponse(
                    RequestId: request.RequestId,
                    Ok: false,
                    PayloadJson: null,
                    ErrorMessage: ex.Message,
                    Metrics: new PerformanceMetrics(
                        RoundTripMs: totalMs,
                        RevitExecutionMs: totalMs,
                        SerializationMs: 0,
                        RequestBytes: request.PayloadBytes,
                        ResponseBytes: 0
                    )
                )
            );
            await this.WriteFrameAsync(errorFrame, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task PublishDocumentInvalidationAsync(DocumentInvalidationEvent payload) {
        if (!this.IsConnected)
            return;

        var payloadJson = JsonConvert.SerializeObject(payload, this._serializerSettings);
        var frame = new BridgeFrame(
            Kind: BridgeFrameKind.Event,
            Event: new BridgeEvent(HubClientEventNames.DocumentChanged, payloadJson)
        );
        await this.WriteFrameAsync(frame, this._shutdown.Token).ConfigureAwait(false);
    }

    private void SendHandshake() {
        var handshake = new BridgeHandshake(
            ContractVersion: BridgeProtocol.ContractVersion,
            Transport: BridgeProtocol.Transport,
            RevitVersion: Pe.Global.Revit.Utils.Utils.GetRevitVersion() ?? "unknown",
            RuntimeFramework: System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
            HasActiveDocument: DocumentManager.GetActiveDocument() != null,
            ActiveDocumentTitle: DocumentManager.GetActiveDocument()?.Title,
            AvailableModules: this._moduleRegistry.GetModules()
                .OrderBy(module => module.ModuleKey, StringComparer.OrdinalIgnoreCase)
                .Select(module => new SettingsModuleDescriptor(
                    module.ModuleKey,
                    module.DefaultSubDirectory,
                    module.SettingsTypeName,
                    module.SettingsType.FullName ?? module.SettingsType.Name
                ))
                .ToList()
        );

        var frame = new BridgeFrame(
            Kind: BridgeFrameKind.Handshake,
            Handshake: handshake
        );

        // Startup runs on the Revit UI thread, so avoid sync-over-async during the initial bridge handshake.
        var json = JsonConvert.SerializeObject(frame, this._serializerSettings);
        this._writer.WriteLine(json);
    }

    private async Task SendDisconnectAsync() {
        if (!this._pipeClient.IsConnected)
            return;

        await this.WriteFrameAsync(new BridgeFrame(
                Kind: BridgeFrameKind.Disconnect,
                DisconnectReason: "Client disconnect requested."
            ),
            CancellationToken.None).ConfigureAwait(false);
    }

    private async Task WriteFrameAsync(BridgeFrame frame, CancellationToken cancellationToken) {
        var json = JsonConvert.SerializeObject(frame, this._serializerSettings);
        await this._writeLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try {
            await this._writer.WriteLineAsync(json).ConfigureAwait(false);
        } finally {
            _ = this._writeLock.Release();
        }
    }

    private TPayload DeserializePayload<TPayload>(string payloadJson) =>
        JsonConvert.DeserializeObject<TPayload>(payloadJson, this._serializerSettings)
        ?? throw new InvalidOperationException($"Failed to deserialize bridge payload '{typeof(TPayload).Name}'.");

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
                "Settings editor bridge dispose ignored broken I/O while disposing {ResourceName}: Pipe={PipeName}",
                resourceName,
                this._hostOptions.PipeName
            );
        } catch (ObjectDisposedException) {
            // Resource already disposed elsewhere.
        } catch (Exception ex) {
            Log.Warning(
                ex,
                "Settings editor bridge dispose ignored unexpected failure while disposing {ResourceName}: Pipe={PipeName}",
                resourceName,
                this._hostOptions.PipeName
            );
        }
    }
}

internal sealed record HostConnectionOptions(
    string PipeName,
    int ConnectTimeoutMs
) {
    public static HostConnectionOptions FromEnvironment() =>
        new(
            GetValueOrDefault("PE_SETTINGS_EDITOR_PIPE_NAME", BridgeProtocol.DefaultPipeName),
            GetPipeConnectTimeoutMs()
        );

    private static int GetPipeConnectTimeoutMs() {
        var raw = Environment.GetEnvironmentVariable("PE_SETTINGS_EDITOR_PIPE_CONNECT_TIMEOUT_MS");
        return int.TryParse(raw, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : 1500;
    }

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}
