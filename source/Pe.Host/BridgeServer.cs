using Newtonsoft.Json;
using Pe.Shared.HostContracts.Protocol;
using Pe.Host.Services;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Text;

namespace Pe.Host;

public sealed class BridgeServer(
    HostEventStreamService eventStreamService,
    ILogger<BridgeServer> logger,
    BridgeHostOptions options
) : BackgroundService {
    private readonly HostEventStreamService _eventStreamService = eventStreamService;
    private readonly ILogger<BridgeServer> _logger = logger;
    private readonly BridgeHostOptions _options = options;

    private readonly ConcurrentDictionary<string, TaskCompletionSource<BridgeResponse>> _pending =
        new(StringComparer.Ordinal);

    private readonly JsonSerializerSettings _serializerSettings = HostJson.CreateSerializerSettings();
    private readonly object _sessionSync = new();
    private readonly object _snapshotSync = new();
    private BridgeSession? _session;
    private BridgeSnapshot _snapshot = BridgeSnapshot.Disconnected();

    public bool IsConnected => this.GetSnapshot().BridgeIsConnected;

    public BridgeSnapshot GetSnapshot() {
        lock (this._snapshotSync)
            return this._snapshot with { AvailableModules = [.. this._snapshot.AvailableModules] };
    }

    public async Task<TResponse> InvokeAsync<TRequest, TResponse>(
        string method,
        TRequest request,
        CancellationToken cancellationToken = default
    ) {
        var session = this.GetSessionOrThrow();
        var requestId = Guid.NewGuid().ToString("N");
        var payloadJson = JsonConvert.SerializeObject(request, this._serializerSettings);
        var payloadBytes = Encoding.UTF8.GetByteCount(payloadJson);
        var requestFrame = new BridgeFrame(
            BridgeFrameKind.Request,
            Request: new BridgeRequest(
                requestId,
                method,
                payloadJson,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                payloadBytes
            )
        );

        var completion = new TaskCompletionSource<BridgeResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!this._pending.TryAdd(requestId, completion))
            throw new InvalidOperationException($"Duplicate bridge request ID '{requestId}'.");

        try {
            this._logger.LogInformation(
                "Bridge request dispatch starting: Method={Method}, RequestId={RequestId}, RequestBytes={RequestBytes}",
                method,
                requestId,
                payloadBytes
            );
            await session.WriteAsync(requestFrame, cancellationToken);
            using var registration = cancellationToken.Register(() =>
                completion.TrySetCanceled(cancellationToken));
            var response = await completion.Task;
            if (!response.Ok)
                throw new InvalidOperationException(response.ErrorMessage ?? "Bridge request failed.");

            if (string.IsNullOrWhiteSpace(response.PayloadJson))
                throw new InvalidOperationException("Bridge returned an empty payload.");

            this._logger.LogDebug(
                "Bridge response: Method={Method}, RequestId={RequestId}, RoundTripMs={RoundTripMs}, RevitExecutionMs={RevitExecutionMs}, RequestBytes={RequestBytes}, ResponseBytes={ResponseBytes}",
                method,
                requestId,
                response.Metrics.RoundTripMs,
                response.Metrics.RevitExecutionMs,
                response.Metrics.RequestBytes,
                response.Metrics.ResponseBytes
            );

            return JsonConvert.DeserializeObject<TResponse>(response.PayloadJson, this._serializerSettings)
                   ?? throw new InvalidOperationException($"Failed to deserialize bridge response for '{method}'.");
        } finally {
            _ = this._pending.TryRemove(requestId, out _);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        while (!stoppingToken.IsCancellationRequested) {
            try {
                using var stream = new NamedPipeServerStream(
                    this._options.PipeName,
                    PipeDirection.InOut,
                    1,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous
                );

                this._logger.LogInformation("Waiting for Revit bridge client on pipe '{PipeName}'",
                    this._options.PipeName);
                await stream.WaitForConnectionAsync(stoppingToken);
                await this.RunSessionAsync(stream, stoppingToken);
            } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
                break;
            } catch (Exception ex) {
                this._logger.LogError(ex, "Bridge server session failed.");
                this.ResetSession("bridge session failed");
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }

    private async Task RunSessionAsync(NamedPipeServerStream stream, CancellationToken cancellationToken) {
        var session = new BridgeSession(stream, this._serializerSettings, this._logger);
        this.SetSession(session);
        this._logger.LogInformation("Bridge server accepted pipe client. Waiting for handshake.");

        try {
            var handshakeFrame = await session.ReadAsync(cancellationToken);
            var handshake = handshakeFrame?.Handshake;
            if (handshakeFrame?.Kind != BridgeFrameKind.Handshake || handshake == null)
                throw new InvalidOperationException("Expected handshake frame from Revit bridge client.");

            ValidateHandshake(handshake);
            this.UpdateHandshake(handshake);
            await this.PublishHostStatusChangedAsync(
                HostStatusChangedReason.BridgeConnected,
                handshake.HasActiveDocument,
                handshake.ActiveDocumentTitle,
                cancellationToken
            );
            this._logger.LogInformation(
                "Revit bridge connected: RevitVersion={RevitVersion}, Runtime={RuntimeFramework}, Modules={ModuleCount}, HasActiveDocument={HasActiveDocument}, ActiveDocumentTitle={ActiveDocumentTitle}",
                handshake.RevitVersion,
                handshake.RuntimeFramework,
                handshake.AvailableModules.Count,
                handshake.HasActiveDocument,
                handshake.ActiveDocumentTitle
            );

            while (!cancellationToken.IsCancellationRequested && stream.IsConnected) {
                var frame = await session.ReadAsync(cancellationToken);
                if (frame == null)
                    break;

                switch (frame.Kind) {
                case BridgeFrameKind.Response:
                    if (frame.Response != null &&
                        this._pending.TryRemove(frame.Response.RequestId, out var completion))
                        _ = completion.TrySetResult(frame.Response);
                    break;
                case BridgeFrameKind.Event:
                    await this.HandleEventAsync(frame.Event, cancellationToken);
                    break;
                case BridgeFrameKind.Handshake:
                    if (frame.Handshake != null) {
                        ValidateHandshake(frame.Handshake);
                        this.UpdateHandshake(frame.Handshake);
                        await this.PublishHostStatusChangedAsync(
                            HostStatusChangedReason.BridgeHandshakeRefreshed,
                            frame.Handshake.HasActiveDocument,
                            frame.Handshake.ActiveDocumentTitle,
                            cancellationToken
                        );
                        this._logger.LogInformation("Revit bridge handshake refreshed.");
                    }

                    break;
                case BridgeFrameKind.Disconnect:
                    this._logger.LogInformation("Revit bridge requested disconnect: {Reason}", frame.DisconnectReason);
                    return;
                default:
                    this._logger.LogDebug("Bridge server ignored frame kind {FrameKind}.", frame.Kind);
                    break;
                }
            }
        } finally {
            this.ResetSession("bridge disconnected");
        }
    }

    private async Task HandleEventAsync(BridgeEvent? bridgeEvent, CancellationToken cancellationToken) {
        if (bridgeEvent == null)
            return;

        if (string.Equals(bridgeEvent.EventName, SettingsHostEventNames.DocumentChanged, StringComparison.Ordinal)) {
            var payload =
                JsonConvert.DeserializeObject<DocumentInvalidationEvent>(bridgeEvent.PayloadJson,
                    this._serializerSettings);
            if (payload != null) {
                var previousSnapshot = this.GetSnapshot();
                this.UpdateDocumentState(payload);
                await this._eventStreamService.PublishDocumentChangedAsync(payload, cancellationToken);

                if (previousSnapshot.HasActiveDocument != payload.HasActiveDocument ||
                    !string.Equals(previousSnapshot.ActiveDocumentTitle, payload.DocumentTitle,
                        StringComparison.Ordinal)) {
                    await this.PublishHostStatusChangedAsync(
                        HostStatusChangedReason.ActiveDocumentChanged,
                        payload.HasActiveDocument,
                        payload.DocumentTitle,
                        cancellationToken
                    );
                }
            }

            return;
        }

        if (string.Equals(bridgeEvent.EventName, HostRuntimeEventNames.Notification, StringComparison.Ordinal)) {
            var message = JsonConvert.DeserializeObject<string>(
                bridgeEvent.PayloadJson,
                this._serializerSettings
            );
            if (!string.IsNullOrWhiteSpace(message)) {
                await this._eventStreamService.PublishAsync(
                    HostRuntimeEventNames.Notification,
                    message,
                    cancellationToken
                );
            }
        }
    }

    private BridgeSession GetSessionOrThrow() {
        lock (this._sessionSync)
            return this._session ?? throw new InvalidOperationException("No Revit agent is currently connected.");
    }

    private void SetSession(BridgeSession session) {
        lock (this._sessionSync)
            this._session = session;
    }

    private void ResetSession(string reason) {
        BridgeSession? session;
        var pendingCount = this._pending.Count;
        lock (this._sessionSync) {
            session = this._session;
            this._session = null;
        }

        this._logger.LogInformation("Bridge server resetting session: Reason={Reason}, PendingRequests={PendingCount}",
            reason, pendingCount);
        session?.Dispose();
        this.ClearConnection(reason);
        _ = this.PublishHostStatusChangedAsync(
            HostStatusChangedReason.BridgeDisconnected,
            false,
            null,
            CancellationToken.None
        );

        foreach (var pending in this._pending.ToArray()) {
            if (this._pending.TryRemove(pending.Key, out var completion))
                _ = completion.TrySetException(new InvalidOperationException($"Revit bridge disconnected: {reason}"));
        }
    }

    private void UpdateHandshake(BridgeHandshake handshake) {
        lock (this._snapshotSync) {
            this._snapshot = new BridgeSnapshot(
                true,
                handshake.HasActiveDocument,
                handshake.ActiveDocumentTitle,
                handshake.RevitVersion,
                handshake.RuntimeFramework,
                handshake.ContractVersion,
                handshake.Transport,
                [.. handshake.AvailableModules],
                null
            );
        }
    }

    private void UpdateDocumentState(DocumentInvalidationEvent payload) {
        lock (this._snapshotSync) {
            this._snapshot = this._snapshot with {
                HasActiveDocument = payload.HasActiveDocument, ActiveDocumentTitle = payload.DocumentTitle
            };
        }
    }

    private void ClearConnection(string? disconnectReason) {
        lock (this._snapshotSync)
            this._snapshot = BridgeSnapshot.Disconnected(disconnectReason);
    }

    private Task PublishHostStatusChangedAsync(
        HostStatusChangedReason reason,
        bool hasActiveDocument,
        string? documentTitle,
        CancellationToken cancellationToken
    ) => this._eventStreamService.PublishHostStatusChangedAsync(
        new HostStatusChangedEvent(reason, hasActiveDocument, documentTitle),
        cancellationToken
    );

    private static void ValidateHandshake(BridgeHandshake handshake) {
        if (!string.Equals(handshake.Transport, BridgeProtocol.Transport, StringComparison.Ordinal)) {
            throw new InvalidOperationException(
                $"Unsupported bridge transport '{handshake.Transport}'. Expected '{BridgeProtocol.Transport}'.");
        }

        if (handshake.ContractVersion != BridgeProtocol.ContractVersion) {
            throw new InvalidOperationException(
                $"Unsupported bridge contract version '{handshake.ContractVersion}'. Expected '{BridgeProtocol.ContractVersion}'.");
        }
    }

    private sealed class BridgeSession : IDisposable {
        private readonly ILogger _logger;
        private readonly StreamReader _reader;
        private readonly JsonSerializerSettings _serializerSettings;
        private readonly SemaphoreSlim _writeLock = new(1, 1);
        private readonly StreamWriter _writer;

        public BridgeSession(Stream stream, JsonSerializerSettings serializerSettings, ILogger logger) {
            this._serializerSettings = serializerSettings;
            this._logger = logger;
            this._reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
            this._writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        }

        public void Dispose() {
            this._writeLock.Dispose();
            this._reader.Dispose();
            this._writer.Dispose();
        }

        public async Task<BridgeFrame?> ReadAsync(CancellationToken cancellationToken) {
            var line = await this._reader.ReadLineAsync(cancellationToken);
            if (line == null)
                return null;

            return JsonConvert.DeserializeObject<BridgeFrame>(line, this._serializerSettings);
        }

        public async Task WriteAsync(BridgeFrame frame, CancellationToken cancellationToken) {
            var json = JsonConvert.SerializeObject(frame, this._serializerSettings);
            await this._writeLock.WaitAsync(cancellationToken);
            try {
                await this._writer.WriteLineAsync(json);
            } finally {
                _ = this._writeLock.Release();
            }
        }
    }
}

public sealed record BridgeSnapshot(
    bool BridgeIsConnected,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    string? RevitVersion,
    string? RuntimeFramework,
    int BridgeContractVersion,
    string BridgeTransport,
    List<HostModuleDescriptor> AvailableModules,
    string? DisconnectReason
) {
    public static BridgeSnapshot Disconnected(string? disconnectReason = null) =>
        new(
            false,
            false,
            null,
            null,
            null,
            BridgeProtocol.ContractVersion,
            BridgeProtocol.Transport,
            [],
            disconnectReason
        );
}