using Newtonsoft.Json;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Protocol;
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
    private readonly ConcurrentDictionary<string, PendingBridgeRequest> _pending = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Task> _sessionTasks = new(StringComparer.Ordinal);
    private readonly JsonSerializerSettings _serializerSettings = HostJson.CreateSerializerSettings();
    private readonly object _sessionSync = new();
    private readonly Dictionary<string, ConnectedBridgeSession> _sessionsById = new(StringComparer.Ordinal);
    private string? _lastDisconnectReason;

    public bool IsConnected => this.GetSnapshot().BridgeIsConnected;

    public BridgeRuntimeSnapshot GetSnapshot() {
        lock (this._sessionSync) {
            var sessions = this._sessionsById.Values
                .Select(entry => entry.Snapshot with { AvailableModules = [.. entry.Snapshot.AvailableModules] })
                .OrderByDescending(session => session.ConnectedAtUnixMs)
                .ThenBy(session => session.SessionId, StringComparer.Ordinal)
                .ToList();
            var defaultSession = sessions.FirstOrDefault();

            return new BridgeRuntimeSnapshot(
                sessions.Count != 0,
                this._options.PipeName,
                defaultSession?.SessionId,
                defaultSession,
                sessions,
                sessions.Count == 0 ? this._lastDisconnectReason : null
            );
        }
    }

    public async Task<TResponse> InvokeAsync<TRequest, TResponse>(
        string method,
        TRequest request,
        CancellationToken cancellationToken = default
    ) {
        var target = (request as IBridgeSessionRequest)?.Target;
        var connectedSession = this.ResolveSessionOrThrow(target);
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
        var pendingRequest = new PendingBridgeRequest(connectedSession.ConnectionId, completion);
        if (!this._pending.TryAdd(requestId, pendingRequest))
            throw new InvalidOperationException($"Duplicate bridge request ID '{requestId}'.");

        try {
            this._logger.LogInformation(
                "Bridge request dispatch starting: Method={Method}, RequestId={RequestId}, RequestBytes={RequestBytes}, SessionId={SessionId}, RevitVersion={RevitVersion}",
                method,
                requestId,
                payloadBytes,
                connectedSession.Snapshot.SessionId,
                connectedSession.Snapshot.RevitVersion
            );
            await connectedSession.TransportSession.WriteAsync(requestFrame, cancellationToken);
            using var registration = cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
            var response = await completion.Task;
            if (!response.Ok)
                throw new InvalidOperationException(response.ErrorMessage ?? "Bridge request failed.");

            if (string.IsNullOrWhiteSpace(response.PayloadJson))
                throw new InvalidOperationException("Bridge returned an empty payload.");

            this._logger.LogDebug(
                "Bridge response: Method={Method}, RequestId={RequestId}, RoundTripMs={RoundTripMs}, RevitExecutionMs={RevitExecutionMs}, RequestBytes={RequestBytes}, ResponseBytes={ResponseBytes}, SessionId={SessionId}",
                method,
                requestId,
                response.Metrics.RoundTripMs,
                response.Metrics.RevitExecutionMs,
                response.Metrics.RequestBytes,
                response.Metrics.ResponseBytes,
                connectedSession.Snapshot.SessionId
            );

            return JsonConvert.DeserializeObject<TResponse>(response.PayloadJson, this._serializerSettings)
                   ?? throw new InvalidOperationException($"Failed to deserialize bridge response for '{method}'.");
        } finally {
            _ = this._pending.TryRemove(requestId, out _);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        try {
            while (!stoppingToken.IsCancellationRequested) {
                var stream = new NamedPipeServerStream(
                    this._options.PipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous
                );

                try {
                    this._logger.LogInformation("Waiting for Revit bridge clients on pipe '{PipeName}'",
                        this._options.PipeName);
                    await stream.WaitForConnectionAsync(stoppingToken);
                } catch {
                    stream.Dispose();
                    throw;
                }

                var taskId = Guid.NewGuid().ToString("N");
                var sessionTask = this.RunSessionAsync(stream, stoppingToken);
                this._sessionTasks[taskId] = sessionTask;
                _ = sessionTask.ContinueWith(
                    completedSessionTask => {
                        _ = this._sessionTasks.TryRemove(taskId, out var removedSessionTask);
                    },
                    CancellationToken.None,
                    TaskContinuationOptions.ExecuteSynchronously,
                    TaskScheduler.Default
                );
            }
        } catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) {
            // Expected on shutdown.
        } finally {
            var sessionTasks = this._sessionTasks.Values.ToArray();
            if (sessionTasks.Length != 0)
                await Task.WhenAll(sessionTasks);
        }
    }

    private async Task RunSessionAsync(NamedPipeServerStream stream, CancellationToken cancellationToken) {
        var transportSession = new BridgeSession(stream, this._serializerSettings);
        BridgeSessionSnapshot? connectedSnapshot = null;
        var disconnectReason = "bridge disconnected";

        try {
            this._logger.LogInformation("Bridge server accepted pipe client. Waiting for handshake.");
            var handshakeFrame = await transportSession.ReadAsync(cancellationToken);
            var handshake = handshakeFrame?.Handshake;
            if (handshakeFrame?.Kind != BridgeFrameKind.Handshake || handshake == null)
                throw new InvalidOperationException("Expected handshake frame from Revit bridge client.");

            ValidateHandshake(handshake);
            connectedSnapshot = this.RegisterSession(transportSession, handshake);
            await this.PublishHostStatusChangedAsync(
                HostStatusChangedReason.BridgeConnected,
                connectedSnapshot,
                cancellationToken
            );
            this._logger.LogInformation(
                "Revit bridge connected: SessionId={SessionId}, ProcessId={ProcessId}, RevitVersion={RevitVersion}, Runtime={RuntimeFramework}, Modules={ModuleCount}, HasActiveDocument={HasActiveDocument}, ActiveDocumentTitle={ActiveDocumentTitle}",
                connectedSnapshot.SessionId,
                connectedSnapshot.ProcessId,
                connectedSnapshot.RevitVersion,
                connectedSnapshot.RuntimeFramework,
                connectedSnapshot.AvailableModules.Count,
                connectedSnapshot.HasActiveDocument,
                connectedSnapshot.ActiveDocumentTitle
            );

            while (!cancellationToken.IsCancellationRequested && stream.IsConnected) {
                var frame = await transportSession.ReadAsync(cancellationToken);
                if (frame == null) {
                    disconnectReason = "bridge client closed the pipe";
                    break;
                }

                switch (frame.Kind) {
                case BridgeFrameKind.Response:
                    if (frame.Response != null &&
                        this._pending.TryRemove(frame.Response.RequestId, out var pending) &&
                        string.Equals(pending.ConnectionId, transportSession.ConnectionId, StringComparison.Ordinal)) {
                        _ = pending.Completion.TrySetResult(frame.Response);
                    }

                    break;
                case BridgeFrameKind.Event:
                    if (connectedSnapshot != null) {
                        await this.HandleEventAsync(
                            connectedSnapshot.SessionId,
                            transportSession.ConnectionId,
                            frame.Event,
                            cancellationToken
                        );
                    }

                    break;
                case BridgeFrameKind.Handshake:
                    if (frame.Handshake != null) {
                        ValidateHandshake(frame.Handshake);
                        connectedSnapshot = this.UpdateHandshake(transportSession.ConnectionId, frame.Handshake);
                        if (connectedSnapshot != null) {
                            await this.PublishHostStatusChangedAsync(
                                HostStatusChangedReason.BridgeHandshakeRefreshed,
                                connectedSnapshot,
                                cancellationToken
                            );
                            this._logger.LogInformation(
                                "Revit bridge handshake refreshed: SessionId={SessionId}",
                                connectedSnapshot.SessionId
                            );
                        }
                    }

                    break;
                case BridgeFrameKind.Disconnect:
                    disconnectReason = frame.DisconnectReason ?? "bridge client requested disconnect";
                    this._logger.LogInformation("Revit bridge requested disconnect: SessionId={SessionId}, Reason={Reason}",
                        connectedSnapshot?.SessionId, disconnectReason);
                    return;
                default:
                    this._logger.LogDebug("Bridge server ignored frame kind {FrameKind}.", frame.Kind);
                    break;
                }
            }
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            disconnectReason = "host shutdown requested";
        } catch (Exception ex) {
            disconnectReason = ex.Message;
            this._logger.LogError(ex, "Bridge server session failed: ConnectionId={ConnectionId}",
                transportSession.ConnectionId);
        } finally {
            this.ResetSession(transportSession, connectedSnapshot, disconnectReason);
        }
    }

    private async Task HandleEventAsync(
        string sessionId,
        string connectionId,
        BridgeEvent? bridgeEvent,
        CancellationToken cancellationToken
    ) {
        if (bridgeEvent == null)
            return;

        if (string.Equals(bridgeEvent.EventName, SettingsHostEventNames.DocumentChanged, StringComparison.Ordinal)) {
            var payload = JsonConvert.DeserializeObject<DocumentInvalidationEvent>(
                bridgeEvent.PayloadJson,
                this._serializerSettings
            );
            if (payload != null) {
                var updatedSession = this.UpdateDocumentState(sessionId, connectionId, payload);
                var sessionAwarePayload = payload with {
                    SessionId = payload.SessionId ?? updatedSession?.SessionId ?? sessionId,
                    RevitVersion = payload.RevitVersion ?? updatedSession?.RevitVersion
                };

                await this._eventStreamService.PublishDocumentChangedAsync(sessionAwarePayload, cancellationToken);
                await this.PublishHostStatusChangedAsync(
                    HostStatusChangedReason.ActiveDocumentChanged,
                    updatedSession,
                    cancellationToken
                );
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

    private ConnectedBridgeSession ResolveSessionOrThrow(BridgeSessionSelector? target) {
        lock (this._sessionSync) {
            if (this._sessionsById.Count == 0)
                throw new InvalidOperationException("No Revit agent is currently connected.");

            if (!string.IsNullOrWhiteSpace(target?.SessionId)) {
                if (this._sessionsById.TryGetValue(target.SessionId, out var exactSession))
                    return exactSession;

                throw new InvalidOperationException(
                    $"No connected Revit session matched session ID '{target.SessionId}'.");
            }

            IEnumerable<ConnectedBridgeSession> candidateSessions = this._sessionsById.Values;
            if (!string.IsNullOrWhiteSpace(target?.RevitVersion)) {
                candidateSessions = candidateSessions.Where(session =>
                    string.Equals(
                        session.Snapshot.RevitVersion,
                        target.RevitVersion,
                        StringComparison.OrdinalIgnoreCase
                    ));
            }

            var resolvedSession = candidateSessions
                .OrderByDescending(session => session.Snapshot.ConnectedAtUnixMs)
                .ThenBy(session => session.Snapshot.SessionId, StringComparer.Ordinal)
                .FirstOrDefault();

            if (resolvedSession != null)
                return resolvedSession;

            throw new InvalidOperationException(
                $"No connected Revit session matched target '{FormatTarget(target)}'.");
        }
    }

    private BridgeSessionSnapshot RegisterSession(BridgeSession transportSession, BridgeHandshake handshake) {
        var snapshot = new BridgeSessionSnapshot(
            handshake.SessionId,
            handshake.RevitVersion,
            handshake.ProcessId,
            handshake.HasActiveDocument,
            handshake.ActiveDocumentTitle,
            handshake.RuntimeFramework,
            handshake.ContractVersion,
            handshake.Transport,
            [.. handshake.AvailableModules],
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );

        ConnectedBridgeSession? replacedSession = null;
        lock (this._sessionSync) {
            if (this._sessionsById.TryGetValue(snapshot.SessionId, out replacedSession) &&
                string.Equals(replacedSession.ConnectionId, transportSession.ConnectionId, StringComparison.Ordinal)) {
                replacedSession = null;
            }

            this._sessionsById[snapshot.SessionId] = new ConnectedBridgeSession(
                transportSession.ConnectionId,
                transportSession,
                snapshot
            );
            this._lastDisconnectReason = null;
        }

        if (replacedSession != null) {
            this._logger.LogWarning(
                "Replacing existing bridge session: SessionId={SessionId}, PreviousConnectionId={PreviousConnectionId}, NewConnectionId={NewConnectionId}",
                snapshot.SessionId,
                replacedSession.ConnectionId,
                transportSession.ConnectionId
            );
            replacedSession.TransportSession.Dispose();
            this.FailPendingRequests(replacedSession.ConnectionId, "bridge session was replaced by a newer connection");
        }

        return snapshot;
    }

    private BridgeSessionSnapshot? UpdateHandshake(string connectionId, BridgeHandshake handshake) {
        lock (this._sessionSync) {
            if (!this._sessionsById.TryGetValue(handshake.SessionId, out var session) ||
                !string.Equals(session.ConnectionId, connectionId, StringComparison.Ordinal))
                return null;

            var updatedSession = session with {
                Snapshot = session.Snapshot with {
                    RevitVersion = handshake.RevitVersion,
                    ProcessId = handshake.ProcessId,
                    HasActiveDocument = handshake.HasActiveDocument,
                    ActiveDocumentTitle = handshake.ActiveDocumentTitle,
                    RuntimeFramework = handshake.RuntimeFramework,
                    BridgeContractVersion = handshake.ContractVersion,
                    BridgeTransport = handshake.Transport,
                    AvailableModules = [.. handshake.AvailableModules]
                }
            };
            this._sessionsById[handshake.SessionId] = updatedSession;
            return updatedSession.Snapshot;
        }
    }

    private BridgeSessionSnapshot? UpdateDocumentState(
        string sessionId,
        string connectionId,
        DocumentInvalidationEvent payload
    ) {
        lock (this._sessionSync) {
            if (!this._sessionsById.TryGetValue(sessionId, out var session) ||
                !string.Equals(session.ConnectionId, connectionId, StringComparison.Ordinal))
                return null;

            var updatedSession = session with {
                Snapshot = session.Snapshot with {
                    HasActiveDocument = payload.HasActiveDocument, ActiveDocumentTitle = payload.DocumentTitle
                }
            };
            this._sessionsById[sessionId] = updatedSession;
            return updatedSession.Snapshot;
        }
    }

    private void ResetSession(
        BridgeSession transportSession,
        BridgeSessionSnapshot? connectedSnapshot,
        string reason
    ) {
        BridgeSessionSnapshot? removedSnapshot = null;
        lock (this._sessionSync) {
            if (connectedSnapshot != null &&
                this._sessionsById.TryGetValue(connectedSnapshot.SessionId, out var currentSession) &&
                string.Equals(currentSession.ConnectionId, transportSession.ConnectionId, StringComparison.Ordinal)) {
                removedSnapshot = currentSession.Snapshot;
                this._sessionsById.Remove(connectedSnapshot.SessionId);
                if (this._sessionsById.Count == 0)
                    this._lastDisconnectReason = reason;
            }
        }

        this._logger.LogInformation(
            "Bridge server resetting session: SessionId={SessionId}, ConnectionId={ConnectionId}, Reason={Reason}",
            connectedSnapshot?.SessionId,
            transportSession.ConnectionId,
            reason
        );
        transportSession.Dispose();
        this.FailPendingRequests(transportSession.ConnectionId, reason);

        if (removedSnapshot != null) {
            _ = this.PublishHostStatusChangedAsync(
                HostStatusChangedReason.BridgeDisconnected,
                removedSnapshot,
                CancellationToken.None
            );
        }
    }

    private void FailPendingRequests(string connectionId, string reason) {
        foreach (var pending in this._pending.ToArray()) {
            if (!string.Equals(pending.Value.ConnectionId, connectionId, StringComparison.Ordinal))
                continue;

            if (this._pending.TryRemove(pending.Key, out var completion)) {
                _ = completion.Completion.TrySetException(
                    new InvalidOperationException($"Revit bridge disconnected: {reason}")
                );
            }
        }
    }

    private Task PublishHostStatusChangedAsync(
        HostStatusChangedReason reason,
        BridgeSessionSnapshot? sessionSnapshot,
        CancellationToken cancellationToken
    ) => this._eventStreamService.PublishHostStatusChangedAsync(
        new HostStatusChangedEvent(
            reason,
            sessionSnapshot?.HasActiveDocument ?? false,
            sessionSnapshot?.ActiveDocumentTitle,
            sessionSnapshot?.SessionId,
            sessionSnapshot?.RevitVersion,
            this.GetConnectedSessionCount()
        ),
        cancellationToken
    );

    private int GetConnectedSessionCount() {
        lock (this._sessionSync)
            return this._sessionsById.Count;
    }

    private static void ValidateHandshake(BridgeHandshake handshake) {
        if (!string.Equals(handshake.Transport, BridgeProtocol.Transport, StringComparison.Ordinal)) {
            throw new InvalidOperationException(
                $"Unsupported bridge transport '{handshake.Transport}'. Expected '{BridgeProtocol.Transport}'.");
        }

        if (handshake.ContractVersion != BridgeProtocol.ContractVersion) {
            throw new InvalidOperationException(
                $"Unsupported bridge contract version '{handshake.ContractVersion}'. Expected '{BridgeProtocol.ContractVersion}'.");
        }

        if (string.IsNullOrWhiteSpace(handshake.SessionId))
            throw new InvalidOperationException("Bridge handshake did not include a session ID.");
    }

    private static string FormatTarget(BridgeSessionSelector? target) {
        if (target == null)
            return "default";

        if (!string.IsNullOrWhiteSpace(target.SessionId))
            return $"session:{target.SessionId}";

        if (!string.IsNullOrWhiteSpace(target.RevitVersion))
            return $"revit:{target.RevitVersion}";

        return "default";
    }

    internal sealed class BridgeSession : IDisposable {
        private readonly StreamReader _reader;
        private readonly JsonSerializerSettings _serializerSettings;
        private readonly Stream _stream;
        private readonly SemaphoreSlim _writeLock = new(1, 1);
        private readonly StreamWriter _writer;

        public BridgeSession(Stream stream, JsonSerializerSettings serializerSettings) {
            this.ConnectionId = Guid.NewGuid().ToString("N");
            this._stream = stream;
            this._serializerSettings = serializerSettings;
            this._reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);
            this._writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true) { AutoFlush = true };
        }

        public string ConnectionId { get; }

        public void Dispose() {
            this._writeLock.Dispose();
            this._reader.Dispose();
            this._writer.Dispose();
            this._stream.Dispose();
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

internal sealed record PendingBridgeRequest(
    string ConnectionId,
    TaskCompletionSource<BridgeResponse> Completion
);

internal sealed record ConnectedBridgeSession(
    string ConnectionId,
    BridgeServer.BridgeSession TransportSession,
    BridgeSessionSnapshot Snapshot
);

public sealed record BridgeRuntimeSnapshot(
    bool BridgeIsConnected,
    string PipeName,
    string? DefaultSessionId,
    BridgeSessionSnapshot? DefaultSession,
    List<BridgeSessionSnapshot> Sessions,
    string? DisconnectReason
);

public sealed record BridgeSessionSnapshot(
    string SessionId,
    string RevitVersion,
    int ProcessId,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    string? RuntimeFramework,
    int BridgeContractVersion,
    string BridgeTransport,
    List<HostModuleDescriptor> AvailableModules,
    long ConnectedAtUnixMs
);
