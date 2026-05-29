using Pe.Host.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host;

public sealed class BridgeSessionManager {
    private readonly object _sync = new();
    private ConnectedBridgeSession? _session;
    private string? _lastDisconnectReason;

    internal BridgeRuntimeSnapshot GetSnapshot() {
        lock (this._sync) {
            return new BridgeRuntimeSnapshot(
                this._session != null,
                HttpRoutes.Bridge,
                this._session?.Snapshot.DeepCopy(),
                this._session == null ? this._lastDisconnectReason : null
            );
        }
    }

    internal ConnectedBridgeSession ResolveSessionOrThrow() {
        lock (this._sync) {
            if (this._session != null)
                return this._session;

            var detail = string.IsNullOrWhiteSpace(this._lastDisconnectReason)
                ? "No connected Revit bridge session."
                : $"No connected Revit bridge session. Last disconnect reason: {this._lastDisconnectReason}";
            throw new HostOperationException(StatusCodes.Status503ServiceUnavailable, detail);
        }
    }

    internal BridgeRegistrationResult Register(
        BridgeTransportSession transportSession,
        BridgeRegistrationRequest registration
    ) {
        var snapshot = BridgeSessionSnapshot.Create(registration);
        ConnectedBridgeSession? replacedSession = null;
        string? replacedReason = null;

        lock (this._sync) {
            if (this._session != null) {
                replacedSession = this._session;
                replacedReason = string.Equals(
                    replacedSession.Snapshot.SessionId,
                    snapshot.SessionId,
                    StringComparison.Ordinal
                )
                    ? $"Bridge session reconnected by SessionId={snapshot.SessionId}, ProcessId={snapshot.ProcessId}."
                    : $"Bridge session taken over by SessionId={snapshot.SessionId}, ProcessId={snapshot.ProcessId}.";
            }

            this._session = new ConnectedBridgeSession(
                transportSession.ConnectionId,
                transportSession,
                snapshot
            );
            this._lastDisconnectReason = null;
        }

        replacedSession?.TransportSession.Dispose();
        return new BridgeRegistrationResult(
            snapshot,
            new BridgeRegistrationAck(
                true,
                null,
                snapshot.SessionId,
                snapshot.ProcessId
            ),
            replacedSession?.Snapshot.DeepCopy(),
            replacedReason,
            replacedSession?.ConnectionId
        );
    }

    internal BridgeSessionSnapshot? ApplyStateSync(
        string connectionId,
        BridgeStateSync stateSync
    ) {
        lock (this._sync) {
            if (this._session == null || this._session.ConnectionId != connectionId)
                return null;

            this._session = this._session with {
                Snapshot = BridgeSessionStateReducer.ApplyStateSync(this._session.Snapshot, stateSync)
            };
            return this._session.Snapshot.DeepCopy();
        }
    }

    internal BridgeSessionSnapshot? ApplyDocumentChanged(
        string sessionId,
        string connectionId,
        DocumentInvalidationEvent payload
    ) {
        lock (this._sync) {
            if (this._session == null ||
                this._session.ConnectionId != connectionId ||
                !string.Equals(this._session.Snapshot.SessionId, sessionId, StringComparison.Ordinal)) {
                return null;
            }

            this._session = this._session with {
                Snapshot = BridgeSessionStateReducer.ApplyDocumentChanged(this._session.Snapshot, payload)
            };
            return this._session.Snapshot.DeepCopy();
        }
    }

    internal BridgeSessionSnapshot? Disconnect(
        string connectionId,
        string reason
    ) {
        BridgeSessionSnapshot? removedSnapshot = null;
        lock (this._sync) {
            if (this._session != null && this._session.ConnectionId == connectionId) {
                removedSnapshot = this._session.Snapshot;
                this._session = null;
                this._lastDisconnectReason = reason;
            }
        }

        return removedSnapshot?.DeepCopy();
    }
}

internal sealed record ConnectedBridgeSession(
    string ConnectionId,
    BridgeTransportSession TransportSession,
    BridgeSessionSnapshot Snapshot
);

internal sealed record BridgeRegistrationResult(
    BridgeSessionSnapshot? Session,
    BridgeRegistrationAck Ack,
    BridgeSessionSnapshot? ReplacedSession = null,
    string? ReplacedDisconnectReason = null,
    string? ReplacedConnectionId = null
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

    public BridgeSessionSnapshot DeepCopy() => BridgeSessionStateReducer.DeepCopy(this);

    public static BridgeSessionSnapshot Create(BridgeRegistrationRequest registration) =>
        BridgeSessionStateReducer.CreateFromRegistration(registration);
}
