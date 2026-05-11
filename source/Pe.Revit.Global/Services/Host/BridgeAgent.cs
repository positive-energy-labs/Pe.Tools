using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Revit.Global.Services.Host.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Shared.HostContracts;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.Product;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;
using Pe.Shared.StorageRuntime.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;
using System.Net.WebSockets;
using System.Runtime.InteropServices;

namespace Pe.Revit.Global.Services.Host;

internal sealed class BridgeOperationContext(
    RequestService requestService,
    RevitDataRequestService revitDataRequestService,
    ScriptingBridgeMessageHandler scriptingMessageHandler
) {
    public RequestService RequestService { get; } = requestService;
    public RevitDataRequestService RevitDataRequestService { get; } = revitDataRequestService;
    public ScriptingBridgeMessageHandler ScriptingMessageHandler { get; } = scriptingMessageHandler;
}

internal sealed class BridgeRequestDispatcher(
    BridgeOperationRegistry registry,
    JsonSerializerSettings serializerSettings
) {
    private readonly BridgeOperationRegistry _registry = registry;
    private readonly JsonSerializerSettings _serializerSettings = serializerSettings;

    public async Task<object?> DispatchAsync(
        string operationKey,
        string payloadJson,
        BridgeOperationContext context,
        CancellationToken cancellationToken
    ) {
        if (!this._registry.TryGet(operationKey, out var operation))
            throw new InvalidOperationException($"Unsupported bridge operation '{operationKey}'.");

        var request = JsonConvert.DeserializeObject(
                          payloadJson,
                          operation.Definition.RequestType,
                          this._serializerSettings
                      )
                      ?? throw new InvalidOperationException(
                          $"Failed to deserialize bridge payload '{operation.Definition.RequestType.Name}' for '{operationKey}'."
                      );

        return await operation.ExecuteAsync(request, context, cancellationToken);
    }
}

internal sealed class BridgeAgent : IDisposable {
    private readonly BridgeOperationContext _bridgeOperationContext;
    private readonly BridgeRequestDispatcher _bridgeRequestDispatcher;
    private readonly BridgeDocumentNotifier _documentNotifier;
    private readonly HostConnectionOptions _hostOptions;
    private readonly SettingsRuntimeRegistry _moduleRegistry;
    private readonly BridgeTransportSession _transportSession;
    private readonly ClientWebSocket _webSocket;
    private readonly Task _readLoop;

    private readonly JsonSerializerSettings _serializerSettings = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false, OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    private readonly CancellationTokenSource _shutdown = new();
    private readonly ThrottleGate _throttleGate = new();
    private readonly object _requestExecutionSync = new();
    private bool _disposed;
    private string? _inFlightOperationKey;

    public BridgeAgent(
        SettingsRuntimeRegistry moduleRegistry,
        HostConnectionOptions hostOptions,
        RevitTaskService revitTaskService
    ) {
        var startupStopwatch = Stopwatch.StartNew();
        var uiapp = RevitUiSession.CurrentUIApplication;
        var activeDocument = uiapp.GetActiveDocument();
        this._moduleRegistry = moduleRegistry;
        this._hostOptions = hostOptions;
        Log.Information(
            "Host bridge agent starting: BridgeUri={BridgeUri}, ConnectTimeoutMs={ConnectTimeoutMs}, ActiveDocument={ActiveDocumentTitle}, Modules={ModuleCount}",
            hostOptions.BridgeUri,
            hostOptions.ConnectTimeoutMs,
            activeDocument?.Title,
            moduleRegistry.GetModules().Count()
        );
        var requestService = new RequestService(revitTaskService, this._moduleRegistry, this._throttleGate);
        var revitDataRequestService = new RevitDataRequestService(
            revitTaskService,
            this.PublishNotification
        );
        var bridgeOperationRegistry = new BridgeOperationRegistry();
        var scriptingMessageHandler = new ScriptingBridgeMessageHandler(
            () => RevitUiSession.CurrentUIApplication,
            message => Log.Information("Revit scripting notification: {Message}", message)
        );
        this._bridgeOperationContext = new BridgeOperationContext(
            requestService,
            revitDataRequestService,
            scriptingMessageHandler
        );
        this._bridgeRequestDispatcher =
            new BridgeRequestDispatcher(bridgeOperationRegistry, this._serializerSettings);

        this._webSocket = new ClientWebSocket();
        var connectStopwatch = Stopwatch.StartNew();
        Log.Information("Host bridge agent connecting WebSocket: BridgeUri={BridgeUri}", hostOptions.BridgeUri);
        using (var connectTimeout = new CancellationTokenSource(hostOptions.ConnectTimeoutMs)) {
            this._webSocket.ConnectAsync(hostOptions.BridgeUri, connectTimeout.Token).GetAwaiter().GetResult();
        }

        Log.Information("Host bridge agent connected WebSocket in {ElapsedMs} ms.",
            connectStopwatch.ElapsedMilliseconds);
        this._transportSession = new BridgeTransportSession(
            this._webSocket,
            this._serializerSettings
        );
        this._documentNotifier = new BridgeDocumentNotifier(this.PublishDocumentInvalidationAsync);
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
        this.RevitVersion = Revit.Utils.Utils.GetRevitVersion();
        Log.Information(
            "Host bridge connected in {ElapsedMs} ms: BridgeUri={BridgeUri}, RevitVersion={RevitVersion}, Runtime={RuntimeFramework}, Modules={ModuleCount}",
            startupStopwatch.ElapsedMilliseconds,
            this._hostOptions.BridgeUri,
            this.RevitVersion,
            this.RuntimeFramework,
            this._moduleRegistry.GetModules().Count()
        );
    }

    public bool IsConnected { get; private set; }
    public string? LastError { get; private set; }
    public string? RevitVersion { get; }
    public string? RuntimeFramework { get; }

    public void Dispose() {
        if (this._disposed)
            return;

        var disposeStopwatch = Stopwatch.StartNew();
        this._disposed = true;
        this.IsConnected = false;
        Log.Information("Host bridge disconnecting: BridgeUri={BridgeUri}", this._hostOptions.BridgeUri);

        try {
            _ = this.SendDisconnectAsync();
        } catch {
            // Best-effort disconnect notification only.
        }

        this._shutdown.Cancel();
        Log.Information(
            "Host bridge dispose canceled read loop token. Disposing WebSocket resources to unblock reads.");

        this.SafeDispose("document notifier", this._documentNotifier.Dispose);
        this.SafeDispose("scripting message handler", this._bridgeOperationContext.ScriptingMessageHandler.Dispose);
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
            this._hostOptions.BridgeUri.ToString(),
            this._hostOptions.SessionId,
            this._hostOptions.ProcessId,
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

                Log.Information("Host bridge received request: Method={Method}, RequestId={RequestId}",
                    frame.Request.Method, frame.Request.RequestId);
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
            Log.Information("Host bridge read loop exiting: BridgeUri={BridgeUri}, Disposed={Disposed}",
                this._hostOptions.BridgeUri, this._disposed);
        }
    }

    private async Task HandleRequestAsync(BridgeRequest request, CancellationToken cancellationToken) {
        var startedAt = Stopwatch.GetTimestamp();
        var sentAt = DateTimeOffset.FromUnixTimeMilliseconds(request.SentAtUnixMs);

        try {
            lock (this._requestExecutionSync) {
                if (this._inFlightOperationKey != null) {
                    throw new BridgeOperationException(
                        423,
                        $"Revit is busy executing '{this._inFlightOperationKey}'. Retry '{request.Method}' after the current request completes.",
                        [
                            BridgeOperationExceptions.Issue(
                                "$",
                                "RevitBusy",
                                $"Revit is already executing '{this._inFlightOperationKey}'.",
                                "Retry the request after the current bridge operation finishes."
                            )
                        ]
                    );
                }

                this._inFlightOperationKey = request.Method;
            }

            Log.Information(
                "Host bridge dispatch starting: Method={Method}, RequestId={RequestId}",
                request.Method,
                request.RequestId
            );
            var responseEnvelope = await this._bridgeRequestDispatcher.DispatchAsync(
                request.Method,
                request.PayloadJson,
                this._bridgeOperationContext,
                cancellationToken
            ).ConfigureAwait(false);
            Log.Information(
                "Host bridge dispatch completed: Method={Method}, RequestId={RequestId}",
                request.Method,
                request.RequestId
            );

            var beforeSerialize = Stopwatch.GetTimestamp();
            var payloadJson = JsonConvert.SerializeObject(responseEnvelope, this._serializerSettings);
            var responseBytes = Encoding.UTF8.GetByteCount(payloadJson);
            var serializationMs = GetElapsedMilliseconds(beforeSerialize);
            var totalMs = (long)(DateTimeOffset.UtcNow - sentAt).TotalMilliseconds;
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
                        request.PayloadBytes,
                        responseBytes
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
            Log.Information(
                "Host bridge writing response frame: Method={Method}, RequestId={RequestId}, ResponseBytes={ResponseBytes}",
                request.Method,
                request.RequestId,
                responseBytes
            );
            await this.WriteFrameAsync(frame, cancellationToken).ConfigureAwait(false);
            Log.Information(
                "Host bridge wrote response frame: Method={Method}, RequestId={RequestId}",
                request.Method,
                request.RequestId
            );
        } catch (BridgeOperationException ex) {
            var totalMs = (long)(DateTimeOffset.UtcNow - sentAt).TotalMilliseconds;
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
                        request.PayloadBytes,
                        0
                    )
                )
            );
            Log.Warning(
                ex,
                "Host bridge request failed with expected semantics: Method={Method}, RequestId={RequestId}",
                request.Method,
                request.RequestId
            );
            await this.WriteFrameAsync(errorFrame, cancellationToken).ConfigureAwait(false);
        } catch (Exception ex) {
            var totalMs = (long)(DateTimeOffset.UtcNow - sentAt).TotalMilliseconds;
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
                        request.PayloadBytes,
                        0
                    )
                )
            );
            Log.Error(
                ex,
                "Host bridge request failed: Method={Method}, RequestId={RequestId}",
                request.Method,
                request.RequestId
            );
            await this.WriteFrameAsync(errorFrame, cancellationToken).ConfigureAwait(false);
        } finally {
            lock (this._requestExecutionSync) {
                if (string.Equals(this._inFlightOperationKey, request.Method, StringComparison.Ordinal))
                    this._inFlightOperationKey = null;
            }
        }
    }

    private async Task PublishDocumentInvalidationAsync(DocumentInvalidationEvent payload) {
        if (!this.IsConnected)
            return;

        var payloadJson = JsonConvert.SerializeObject(
            payload with { SessionId = this._hostOptions.SessionId, RevitVersion = this.RevitVersion },
            this._serializerSettings
        );
        var frame = new BridgeFrame(
            BridgeFrameKind.Event,
            Event: new BridgeEvent(SettingsHostEventNames.DocumentChanged, payloadJson)
        );
        await this.WriteFrameAsync(frame, this._shutdown.Token).ConfigureAwait(false);
        await this.SendStateSyncAsync(this._shutdown.Token).ConfigureAwait(false);
    }

    private void PublishNotification(string message) {
        if (!this.IsConnected || string.IsNullOrWhiteSpace(message))
            return;

        _ = Task.Run(async () => {
            try {
                await this.PublishNotificationAsync(message).ConfigureAwait(false);
            } catch (Exception ex) {
                Log.Debug(ex, "Host bridge notification publish failed.");
            }
        });
    }

    private async Task PublishNotificationAsync(string message) {
        var payloadJson = JsonConvert.SerializeObject(message, this._serializerSettings);
        var frame = new BridgeFrame(
            BridgeFrameKind.Event,
            Event: new BridgeEvent(HostRuntimeEventNames.Notification, payloadJson)
        );
        await this.WriteFrameAsync(frame, this._shutdown.Token).ConfigureAwait(false);
    }

    private void SendRegistrationAndAwaitAck() {
        var registration = new BridgeRegistrationRequest(
            BridgeProtocol.ContractVersion,
            this._hostOptions.SessionId,
            this._hostOptions.ProcessId,
            this.BuildStateSnapshot()
        );
        this._transportSession.Write(new BridgeFrame(
            BridgeFrameKind.Registration,
            Registration: registration
        ));

        using var timeout = new CancellationTokenSource(this._hostOptions.RegistrationTimeoutMs);
        var ackFrame = this._transportSession.ReadAsync(timeout.Token).GetAwaiter().GetResult();
        var ack = ackFrame?.RegistrationAck;
        if (ackFrame?.Kind != BridgeFrameKind.RegistrationAck || ack == null)
            throw new InvalidOperationException("Host did not acknowledge Revit bridge registration.");
        if (!ack.Accepted)
            throw new InvalidOperationException(ack.ErrorMessage ?? "Host rejected Revit bridge registration.");
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
        var availableModules = this._moduleRegistry.GetModules()
            .Where(SettingsModuleAvailability.IsBridgeDiscoverable)
            .Where(module => SettingsModuleAvailability.IsAvailableForDocument(module, activeDocument))
            .OrderBy(module => module.ModuleKey, StringComparer.OrdinalIgnoreCase)
            .Select(SettingsModuleAvailability.CreateHostModuleDescriptor)
            .ToList();
        Log.Debug(
            "Host bridge state snapshot: ActiveDocument={ActiveDocumentTitle}, ModuleCount={ModuleCount}",
            activeDocument?.Title,
            availableModules.Count
        );
        return new BridgeStateSnapshot(
            Revit.Utils.Utils.GetRevitVersion() ?? "unknown",
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
            RevitUiSession.CurrentUIApplication.GetOpenDocuments().Count(),
            availableModules
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
                this._hostOptions.BridgeUri
            );
        } catch (ObjectDisposedException) {
            // Resource already disposed elsewhere.
        } catch (Exception ex) {
            Log.Warning(
                ex,
                "Host bridge dispose ignored unexpected failure while disposing {ResourceName}: BridgeUri={BridgeUri}",
                resourceName,
                this._hostOptions.BridgeUri
            );
        }
    }
}

internal static class SettingsModuleAvailability {
    public static bool IsBridgeDiscoverable(StructuralSettingsModuleDescriptor module) =>
        module.HostScope != SettingsModuleHostScope.Host;

    public static bool IsAvailableForDocument(
        StructuralSettingsModuleDescriptor module,
        Autodesk.Revit.DB.Document? activeDocument
    ) {
        if (module.HostScope != SettingsModuleHostScope.ActiveDocument)
            return true;

        if (activeDocument == null)
            return false;

        return module.ActiveDocumentKind switch {
            SettingsModuleActiveDocumentKind.ProjectOnly => !activeDocument.IsFamilyDocument,
            SettingsModuleActiveDocumentKind.FamilyOnly => activeDocument.IsFamilyDocument,
            _ => true
        };
    }

    public static HostModuleDescriptor CreateHostModuleDescriptor(StructuralSettingsModuleDescriptor module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.HostScope switch {
                SettingsModuleHostScope.Host => HostModuleScope.Host,
                SettingsModuleHostScope.ActiveDocument => HostModuleScope.ActiveDocument,
                _ => HostModuleScope.Session
            },
            module.ActiveDocumentKind switch {
                SettingsModuleActiveDocumentKind.ProjectOnly => HostModuleActiveDocumentKind.ProjectOnly,
                SettingsModuleActiveDocumentKind.FamilyOnly => HostModuleActiveDocumentKind.FamilyOnly,
                _ => HostModuleActiveDocumentKind.Any
            }
        );

    public static SettingsModuleDescriptor CreateSettingsModuleDescriptor(StructuralSettingsModuleDescriptor module) {
        var hostDescriptor = CreateHostModuleDescriptor(module);
        return new SettingsModuleDescriptor(
            module.ModuleKey,
            module.DefaultRootKey,
            module.Roots.Select(root => new SettingsRootDescriptor(root.RootKey, root.DisplayName)).ToList(),
            new SettingsModuleStorageOptionsContract(
                [.. module.StorageOptions.IncludeRoots],
                [.. module.StorageOptions.PresetRoots]
            ),
            hostDescriptor.Scope,
            hostDescriptor.ActiveDocumentKind
        );
    }
}

internal sealed record HostConnectionOptions(
    string HostBaseUrl,
    string SessionId,
    int ProcessId,
    int ConnectTimeoutMs,
    int RegistrationTimeoutMs
) {
    public Uri BridgeUri { get; } = CreateBridgeUri(HostBaseUrl);

    public static HostConnectionOptions FromEnvironment() =>
        new(
            HostProcessIdentity.ResolveHostBaseUrl(),
            GetSessionId(),
            Process.GetCurrentProcess().Id,
            GetBridgeConnectTimeoutMs(),
            GetHostRegistrationTimeoutMs()
        );

    private static string GetSessionId() {
        using var process = Process.GetCurrentProcess();
        return $"revit-{process.Id}-{process.StartTime.ToUniversalTime().Ticks}";
    }

    private static int GetBridgeConnectTimeoutMs() => HostRuntimeDefaults.DefaultBridgeConnectTimeoutMs;

    private static int GetHostRegistrationTimeoutMs() => HostRuntimeDefaults.DefaultHostRegistrationTimeoutMs;

    private static Uri CreateBridgeUri(string hostBaseUrl) {
        var builder = new UriBuilder(hostBaseUrl.TrimEnd('/') + HttpRoutes.Bridge) {
            Scheme = hostBaseUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ? "wss" : "ws"
        };
        return builder.Uri;
    }
}
