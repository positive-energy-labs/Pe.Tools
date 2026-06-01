using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Host;

internal static class BridgeSessionStateReducer {
    public static BridgeSessionSnapshot CreateFromRegistration(BridgeRegistrationRequest registration) =>
        new(
            registration.SessionId,
            registration.ProcessId,
            registration.State.RevitVersion,
            registration.State.RuntimeFramework,
            registration.ContractVersion,
            CloneState(registration.State),
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );

    public static BridgeSessionSnapshot ApplyStateSync(
        BridgeSessionSnapshot snapshot,
        BridgeStateSync stateSync
    ) => snapshot with {
        State = CloneState(stateSync.State)
    };

    public static BridgeSessionSnapshot ApplyDocumentChanged(
        BridgeSessionSnapshot snapshot,
        DocumentInvalidationEvent payload
    ) {
        var state = snapshot.State;
        return snapshot with {
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
                SharedParametersFilename = state.SharedParametersFilename,
                OpenDocumentCount = payload.OpenDocumentCount,
                AvailableModules = [.. state.AvailableModules]
            }
        };
    }

    public static BridgeSessionSnapshot DeepCopy(BridgeSessionSnapshot snapshot) =>
        snapshot with {
            State = CloneState(snapshot.State)
        };

    public static BridgeStateSnapshot CloneState(BridgeStateSnapshot state) =>
        state with {
            RuntimeAssemblies = [.. state.RuntimeAssemblies],
            AvailableModules = [.. state.AvailableModules]
        };
}
