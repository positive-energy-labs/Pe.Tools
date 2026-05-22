using Newtonsoft.Json;
using Pe.Host.Operations;
using Pe.Host.Services;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Collections.Concurrent;
using System.Net.WebSockets;
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
    private readonly JsonSerializerSettings _serializerSettings = HostJson.CreateSerializerSettings();
    private readonly object _requestAdmissionSync = new();
    private readonly object _sessionSync = new();
    private InFlightBridgeRequest? _inFlightRequest;
    private ConnectedBridgeSession? _session;
    private string? _lastDisconnectReason;

    public bool IsConnected => this.GetSnapshot().BridgeIsConnected;

    public BridgeRuntimeSnapshot GetSnapshot() {
        lock (this._sessionSync) {
            return new BridgeRuntimeSnapshot(
                this._session != null,
                HttpRoutes.Bridge,
                this._session?.Snapshot.DeepCopy(),
                this._session == null ? this._lastDisconnectReason : null
            );
        }
    }

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
        var connectedSession = this.ResolveSessionOrThrow();
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

        var inFlightRequest = new InFlightBridgeRequest(requestId, method, startedAtUnixMs);
        this.AdmitBridgeRequestOrThrow(inFlightRequest);

        var completion = new TaskCompletionSource<BridgeResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        try {
            if (!this._pending.TryAdd(requestId, new PendingBridgeRequest(connectedSession.ConnectionId, completion)))
                throw new InvalidOperationException($"Duplicate bridge request ID '{requestId}'.");

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
            _ = this._pending.TryRemove(requestId, out _);
            this.ReleaseBridgeRequest(requestId);
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
            var registrationResult = this.TryRegisterSession(transportSession, registration);
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
                    if (frame.Response != null &&
                        this._pending.TryRemove(frame.Response.RequestId, out var pending) &&
                        pending.ConnectionId == transportSession.ConnectionId) {
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
                case BridgeFrameKind.StateSync:
                    if (frame.StateSync != null) {
                        connectedSnapshot = this.UpdateStateSnapshot(
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
                await this.PublishSessionConnectionChangedAsync(
                    HostSessionConnectionChangeReason.ActiveDocumentChanged,
                    updatedSession,
                    null,
                    cancellationToken
                );
            }

            return;
        }
    }

    private ConnectedBridgeSession ResolveSessionOrThrow() {
        lock (this._sessionSync) {
            if (this._session != null)
                return this._session;
        }

        var detail = string.IsNullOrWhiteSpace(this._lastDisconnectReason)
            ? "No connected Revit bridge session."
            : $"No connected Revit bridge session. Last disconnect reason: {this._lastDisconnectReason}";
        throw new HostOperationException(StatusCodes.Status503ServiceUnavailable, detail);
    }

    private void AdmitBridgeRequestOrThrow(InFlightBridgeRequest request) {
        lock (this._requestAdmissionSync) {
            if (this._inFlightRequest == null) {
                this._inFlightRequest = request;
                return;
            }

            var elapsedMs = Math.Max(
                0,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - this._inFlightRequest.StartedAtUnixMs
            );
            throw new HostOperationException(
                StatusCodes.Status423Locked,
                $"Revit bridge is busy executing '{this._inFlightRequest.Method}' for {elapsedMs} ms. Retry after the current operation completes.",
                [
                    new ValidationIssue(
                        "$",
                        null,
                        "RevitBridgeBusy",
                        "error",
                        $"The Revit bridge is already executing '{this._inFlightRequest.Method}'.",
                        "Retry after the current operation completes."
                    )
                ]
            );
        }
    }

    private void ReleaseBridgeRequest(string requestId) {
        lock (this._requestAdmissionSync) {
            if (this._inFlightRequest != null &&
                string.Equals(this._inFlightRequest.RequestId, requestId, StringComparison.Ordinal)) {
                this._inFlightRequest = null;
            }
        }
    }

    private BridgeRegistrationResult TryRegisterSession(
        BridgeTransportSession transportSession,
        BridgeRegistrationRequest registration
    ) {
        var snapshot = BridgeSessionSnapshot.Create(registration);

        lock (this._sessionSync) {
            if (this._session != null) {
                var existing = this._session.Snapshot;
                return new BridgeRegistrationResult(
                    null,
                    new BridgeRegistrationAck(
                        false,
                        $"A Revit bridge session is already connected (SessionId={existing.SessionId}, ProcessId={existing.ProcessId}).",
                        existing.SessionId,
                        existing.ProcessId
                    )
                );
            }

            this._session = new ConnectedBridgeSession(
                transportSession.ConnectionId,
                transportSession,
                snapshot
            );
            this._lastDisconnectReason = null;
            return new BridgeRegistrationResult(
                snapshot,
                new BridgeRegistrationAck(
                    true,
                    null,
                    snapshot.SessionId,
                    snapshot.ProcessId
                )
            );
        }
    }

    private BridgeSessionSnapshot? UpdateStateSnapshot(
        string connectionId,
        BridgeStateSync stateSync
    ) {
        lock (this._sessionSync) {
            if (this._session == null || this._session.ConnectionId != connectionId)
                return null;

            this._session = this._session with {
                Snapshot = this._session.Snapshot with {
                    State = this.CloneState(stateSync.State)
                }
            };
            return this._session.Snapshot.DeepCopy();
        }
    }

    private BridgeSessionSnapshot? UpdateDocumentState(
        string sessionId,
        string connectionId,
        DocumentInvalidationEvent payload
    ) {
        lock (this._sessionSync) {
            if (this._session == null ||
                this._session.ConnectionId != connectionId ||
                !string.Equals(this._session.Snapshot.SessionId, sessionId, StringComparison.Ordinal)) {
                return null;
            }

            var state = this._session.Snapshot.State;
            this._session = this._session with {
                Snapshot = this._session.Snapshot with {
                    State = state with {
                        HasActiveDocument = payload.HasActiveDocument,
                        ActiveDocumentTitle = payload.DocumentTitle,
                        ActiveDocumentKey = payload.DocumentKey,
                        ActiveDocumentPath = payload.DocumentPath,
                        ActiveDocumentIsFamilyDocument = payload.DocumentIsFamilyDocument,
                        ActiveDocumentIsWorkshared = payload.DocumentIsWorkshared,
                        ActiveDocumentIsModelInCloud = payload.DocumentIsModelInCloud,
                        ActiveDocumentCloudProjectGuid = payload.DocumentCloudProjectGuid,
                        ActiveDocumentCloudModelGuid = payload.DocumentCloudModelGuid,
                        ActiveDocumentCloudModelUrn = payload.DocumentCloudModelUrn,
                        ActiveDocumentObservedAtUnixMs = payload.DocumentObservedAtUnixMs,
                        OpenDocumentCount = payload.OpenDocumentCount,
                        AvailableModules = [.. state.AvailableModules]
                    }
                }
            };
            return this._session.Snapshot.DeepCopy();
        }
    }

    private void ResetSession(
        BridgeTransportSession transportSession,
        BridgeSessionSnapshot? connectedSnapshot,
        string reason
    ) {
        BridgeSessionSnapshot? removedSnapshot = null;
        lock (this._sessionSync) {
            if (this._session != null && this._session.ConnectionId == transportSession.ConnectionId) {
                removedSnapshot = this._session.Snapshot;
                this._session = null;
                this._lastDisconnectReason = reason;
            }
        }

        transportSession.Dispose();
        this.FailPendingRequests(transportSession.ConnectionId, reason);

        if (removedSnapshot != null) {
            _ = this.PublishSessionConnectionChangedAsync(
                HostSessionConnectionChangeReason.BridgeDisconnected,
                removedSnapshot,
                reason,
                CancellationToken.None
            );
        }
    }

    private void FailPendingRequests(string connectionId, string reason) {
        foreach (var pending in this._pending.ToArray()) {
            if (pending.Value.ConnectionId != connectionId)
                continue;

            if (this._pending.TryRemove(pending.Key, out var completion)) {
                _ = completion.Completion.TrySetException(
                    new HostOperationException(
                        StatusCodes.Status503ServiceUnavailable,
                        $"Revit bridge disconnected: {reason}"
                    )
                );
            }
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

    private BridgeStateSnapshot CloneState(BridgeStateSnapshot state) =>
        state with {
            RuntimeAssemblies = [.. state.RuntimeAssemblies],
            AvailableModules = [.. state.AvailableModules]
        };
}

internal sealed record PendingBridgeRequest(
    string ConnectionId,
    TaskCompletionSource<BridgeResponse> Completion
);

internal sealed record InFlightBridgeRequest(
    string RequestId,
    string Method,
    long StartedAtUnixMs
);

internal sealed record ConnectedBridgeSession(
    string ConnectionId,
    BridgeTransportSession TransportSession,
    BridgeSessionSnapshot Snapshot
);

internal sealed record BridgeRegistrationResult(
    BridgeSessionSnapshot? Session,
    BridgeRegistrationAck Ack
);

public sealed record BridgeRuntimeSnapshot(
    bool BridgeIsConnected,
    string BridgePath,
    BridgeSessionSnapshot? ConnectedSession,
    string? DisconnectReason
);

public sealed record BridgeSessionSnapshot(
    string SessionId,
    int ProcessId,
    string RevitVersion,
    string RuntimeFramework,
    int BridgeContractVersion,
    BridgeStateSnapshot State,
    long ConnectedAtUnixMs
) {
    public bool HasActiveDocument => this.State.HasActiveDocument;
    public string? ActiveDocumentTitle => this.State.ActiveDocumentTitle;
    public string? ActiveDocumentKey => this.State.ActiveDocumentKey;
    public string? ActiveDocumentPath => this.State.ActiveDocumentPath;
    public bool ActiveDocumentIsFamilyDocument => this.State.ActiveDocumentIsFamilyDocument;
    public bool ActiveDocumentIsWorkshared => this.State.ActiveDocumentIsWorkshared;
    public bool ActiveDocumentIsModelInCloud => this.State.ActiveDocumentIsModelInCloud;
    public string? ActiveDocumentCloudProjectGuid => this.State.ActiveDocumentCloudProjectGuid;
    public string? ActiveDocumentCloudModelGuid => this.State.ActiveDocumentCloudModelGuid;
    public string? ActiveDocumentCloudModelUrn => this.State.ActiveDocumentCloudModelUrn;
    public long ActiveDocumentObservedAtUnixMs => this.State.ActiveDocumentObservedAtUnixMs;
    public int OpenDocumentCount => this.State.OpenDocumentCount;
    public List<HostRuntimeAssemblyData> RuntimeAssemblies => this.State.RuntimeAssemblies;
    public List<HostModuleDescriptor> AvailableModules => this.State.AvailableModules;

    public BridgeSessionSnapshot DeepCopy() =>
        this with {
            State = this.State with {
                RuntimeAssemblies = [.. this.State.RuntimeAssemblies],
                AvailableModules = [.. this.State.AvailableModules]
            }
        };

    public static BridgeSessionSnapshot Create(BridgeRegistrationRequest registration) =>
        new(
            registration.SessionId,
            registration.ProcessId,
            registration.State.RevitVersion,
            registration.State.RuntimeFramework,
            registration.ContractVersion,
            registration.State with {
                RuntimeAssemblies = [.. registration.State.RuntimeAssemblies],
                AvailableModules = [.. registration.State.AvailableModules]
            },
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
}
