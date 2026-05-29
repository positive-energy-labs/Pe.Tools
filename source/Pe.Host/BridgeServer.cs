using Newtonsoft.Json;
using Pe.Host.Operations;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Net.WebSockets;
using System.Text;

namespace Pe.Host;

public sealed class BridgeServer(
    HostEventStreamService eventStreamService,
    BridgeSessionManager sessionManager,
    BridgeRequestGate requestGate,
    ILogger<BridgeServer> logger
) : BackgroundService {
    private readonly HostEventStreamService _eventStreamService = eventStreamService;
    private readonly ILogger<BridgeServer> _logger = logger;
    private readonly BridgeRequestGate _requestGate = requestGate;
    private readonly JsonSerializerSettings _serializerSettings = HostJson.CreateSerializerSettings();
    private readonly BridgeSessionManager _sessionManager = sessionManager;

    public bool IsConnected => this.GetSnapshot().BridgeIsConnected;

    public BridgeRuntimeSnapshot GetSnapshot() => this._sessionManager.GetSnapshot();

    public async Task<TResponse> InvokeAsync<TRequest, TResponse>(
        string method,
        TRequest request,
        CancellationToken cancellationToken = default
    ) => (TResponse)await this.InvokeAsync(
        method,
        request,
        typeof(TResponse),
        cancellationToken
    );

    public Task<object> InvokeAsync(
        HostOperationDefinition operation,
        object request,
        CancellationToken cancellationToken = default
    ) => this.InvokeAsync(
        operation.Key,
        request,
        operation.ResponseType,
        cancellationToken
    );

    private async Task<object> InvokeAsync(
        string method,
        object? request,
        Type responseType,
        CancellationToken cancellationToken
    ) {
        var requestId = Guid.NewGuid().ToString("N");
        var startedAtUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var payloadJson = JsonConvert.SerializeObject(request, this._serializerSettings);
        var payloadBytes = Encoding.UTF8.GetByteCount(payloadJson);
        var requestFrame = new BridgeFrame(
            BridgeFrameKind.Request,
            Request: new BridgeRequest(
                requestId,
                method,
                payloadJson,
                startedAtUnixMs,
                payloadBytes
            )
        );

        using var lease = this._requestGate.Admit(requestId, method, startedAtUnixMs);
        try {
            var connectedSession = this._sessionManager.ResolveSessionOrThrow();
            var completion = this._requestGate.Track(connectedSession.ConnectionId, requestId);

            await connectedSession.TransportSession.WriteAsync(requestFrame, cancellationToken);
            var response = await completion.Task;
            if (!response.Ok) {
                throw new HostOperationException(
                    response.StatusCode ?? StatusCodes.Status500InternalServerError,
                    response.ErrorMessage ?? "Bridge request failed.",
                    response.Issues
                );
            }

            if (string.IsNullOrWhiteSpace(response.PayloadJson))
                throw new InvalidOperationException("Bridge returned an empty payload.");

            return JsonConvert.DeserializeObject(response.PayloadJson, responseType, this._serializerSettings)
                   ?? throw new InvalidOperationException($"Failed to deserialize bridge response for '{method}'.");
        } finally {
            this._requestGate.Remove(requestId);
        }
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) => Task.CompletedTask;

    public Task RunWebSocketSessionAsync(WebSocket webSocket, CancellationToken cancellationToken) =>
        this.RunSessionAsync(new BridgeTransportSession(webSocket, this._serializerSettings), cancellationToken);

    private async Task RunSessionAsync(
        BridgeTransportSession transportSession,
        CancellationToken cancellationToken
    ) {
        BridgeSessionSnapshot? connectedSnapshot = null;
        var disconnectReason = "bridge disconnected";

        try {
            var registrationFrame = await transportSession.ReadAsync(cancellationToken);
            var registration = registrationFrame?.Registration;
            if (registrationFrame?.Kind != BridgeFrameKind.Registration || registration == null)
                throw new InvalidOperationException("Expected registration frame from Revit bridge client.");

            ValidateRegistration(registration);
            var registrationResult = this._requestGate.RegisterOrReject(
                this._sessionManager,
                () => this._sessionManager.Register(transportSession, registration)
            );
            connectedSnapshot = registrationResult.Session;

            await transportSession.WriteAsync(
                new BridgeFrame(
                    BridgeFrameKind.RegistrationAck,
                    RegistrationAck: registrationResult.Ack
                ),
                cancellationToken
            );

            if (!registrationResult.Ack.Accepted) {
                await this.PublishSessionConnectionChangedAsync(
                    HostSessionConnectionChangeReason.BridgeRejected,
                    this.GetSnapshot().ConnectedSession,
                    registrationResult.Ack.ErrorMessage,
                    cancellationToken
                );
                disconnectReason = registrationResult.Ack.ErrorMessage ?? "bridge registration rejected";
                return;
            }

            if (registrationResult.ReplacedSession != null) {
                if (!string.IsNullOrWhiteSpace(registrationResult.ReplacedConnectionId)) {
                    this._requestGate.FailConnection(
                        registrationResult.ReplacedConnectionId,
                        registrationResult.ReplacedDisconnectReason ?? "bridge session replaced"
                    );
                }

                await this.PublishSessionConnectionChangedAsync(
                    HostSessionConnectionChangeReason.BridgeDisconnected,
                    registrationResult.ReplacedSession,
                    registrationResult.ReplacedDisconnectReason,
                    cancellationToken
                );
            }

            await this.PublishSessionConnectionChangedAsync(
                HostSessionConnectionChangeReason.BridgeRegistered,
                connectedSnapshot,
                null,
                cancellationToken
            );

            while (!cancellationToken.IsCancellationRequested && transportSession.IsConnected) {
                var frame = await transportSession.ReadAsync(cancellationToken);
                if (frame == null) {
                    disconnectReason = "bridge client closed the websocket";
                    break;
                }

                switch (frame.Kind) {
                case BridgeFrameKind.Response:
                    if (frame.Response != null)
                        _ = this._requestGate.TryCompleteResponse(transportSession.ConnectionId, frame.Response);
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
                case BridgeFrameKind.StateSync:
                    if (frame.StateSync != null) {
                        connectedSnapshot = this._sessionManager.ApplyStateSync(
                            transportSession.ConnectionId,
                            frame.StateSync
                        );
                        if (connectedSnapshot != null) {
                            await this.PublishSessionConnectionChangedAsync(
                                HostSessionConnectionChangeReason.BridgeStateSynchronized,
                                connectedSnapshot,
                                null,
                                cancellationToken
                            );
                        }
                    }

                    break;
                case BridgeFrameKind.Disconnect:
                    disconnectReason = frame.DisconnectReason ?? "bridge client requested disconnect";
                    return;
                }
            }
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            disconnectReason = "host shutdown requested";
        } catch (Exception ex) {
            disconnectReason = ex.Message;
            this._logger.LogError(ex, "Bridge server session failed: ConnectionId={ConnectionId}",
                transportSession.ConnectionId);
        } finally {
            this.ResetSession(transportSession, disconnectReason);
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
                var updatedSession = this._sessionManager.ApplyDocumentChanged(sessionId, connectionId, payload);
                var sessionAwarePayload = payload with {
                    SessionId = payload.SessionId ?? updatedSession?.SessionId ?? sessionId,
                    RevitVersion = payload.RevitVersion ?? updatedSession?.RevitVersion
                };

                await this._eventStreamService.PublishDocumentChangedAsync(sessionAwarePayload, cancellationToken);
                await this.PublishSessionConnectionChangedAsync(
                    HostSessionConnectionChangeReason.ActiveDocumentChanged,
                    updatedSession,
                    null,
                    cancellationToken
                );
            }
        }
    }

    private void ResetSession(
        BridgeTransportSession transportSession,
        string reason
    ) {
        var removedSnapshot = this._sessionManager.Disconnect(transportSession.ConnectionId, reason);

        transportSession.Dispose();
        this._requestGate.FailConnection(transportSession.ConnectionId, reason);

        if (removedSnapshot != null) {
            _ = this.PublishSessionConnectionChangedAsync(
                HostSessionConnectionChangeReason.BridgeDisconnected,
                removedSnapshot,
                reason,
                CancellationToken.None
            );
        }
    }

    private Task PublishSessionConnectionChangedAsync(
        HostSessionConnectionChangeReason reason,
        BridgeSessionSnapshot? sessionSnapshot,
        string? disconnectReason,
        CancellationToken cancellationToken
    ) => this._eventStreamService.PublishSessionConnectionChangedAsync(
        new HostSessionConnectionChangedEvent(
            reason,
            sessionSnapshot != null,
            sessionSnapshot?.SessionId,
            sessionSnapshot?.ProcessId,
            sessionSnapshot?.RevitVersion,
            sessionSnapshot?.RuntimeFramework,
            sessionSnapshot?.OpenDocumentCount ?? 0,
            disconnectReason
        ),
        cancellationToken
    );

    private static void ValidateRegistration(BridgeRegistrationRequest registration) {
        if (registration.ContractVersion != BridgeProtocol.ContractVersion) {
            throw new InvalidOperationException(
                $"Unsupported bridge contract version '{registration.ContractVersion}'. Expected '{BridgeProtocol.ContractVersion}'.");
        }

        if (string.IsNullOrWhiteSpace(registration.SessionId))
            throw new InvalidOperationException("Bridge registration did not include a session ID.");
    }
}
