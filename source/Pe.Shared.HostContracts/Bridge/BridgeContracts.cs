using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Shared.HostContracts.Bridge;

public static class BridgeProtocol {
    public const int ContractVersion = 18;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum BridgeFrameKind {
    Registration,
    RegistrationAck,
    StateSync,
    Request,
    Response,
    Event,
    Disconnect
}

public sealed record BridgeStateSnapshot(
    string RevitVersion,
    string RuntimeFramework,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    string? ActiveDocumentKey,
    string? ActiveDocumentPath,
    bool ActiveDocumentIsFamilyDocument,
    bool ActiveDocumentIsWorkshared,
    bool ActiveDocumentIsModelInCloud,
    string? ActiveDocumentCloudProjectGuid,
    string? ActiveDocumentCloudModelGuid,
    string? ActiveDocumentCloudModelUrn,
    long ActiveDocumentObservedAtUnixMs,
    int OpenDocumentCount,
    List<HostModuleDescriptor> AvailableModules
);

public sealed record BridgeRegistrationRequest(
    int ContractVersion,
    string SessionId,
    int ProcessId,
    BridgeStateSnapshot State
);

public sealed record BridgeRegistrationAck(
    bool Accepted,
    string? ErrorMessage = null,
    string? ExistingSessionId = null,
    int? ExistingProcessId = null
);

public sealed record BridgeStateSync(
    BridgeStateSnapshot State
);

public sealed record BridgeRequest(
    string RequestId,
    string Method,
    string PayloadJson,
    long SentAtUnixMs,
    int PayloadBytes
);

public sealed record BridgeResponse(
    string RequestId,
    bool Ok,
    string? PayloadJson,
    string? ErrorMessage,
    int? StatusCode,
    List<ValidationIssue>? Issues,
    PerformanceMetrics Metrics
);

public sealed record BridgeEvent(
    string EventName,
    string PayloadJson
);

public sealed record PerformanceMetrics(
    long RoundTripMs,
    long RevitExecutionMs,
    long SerializationMs,
    int RequestBytes,
    int ResponseBytes
);

public sealed record BridgeFrame(
    BridgeFrameKind Kind,
    BridgeRegistrationRequest? Registration = null,
    BridgeRegistrationAck? RegistrationAck = null,
    BridgeStateSync? StateSync = null,
    BridgeRequest? Request = null,
    BridgeResponse? Response = null,
    BridgeEvent? Event = null,
    string? DisconnectReason = null
);
