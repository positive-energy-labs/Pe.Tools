using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;

namespace Pe.Shared.HostContracts.Bridge;

public static class BridgeProtocol {
    public const int ContractVersion = 22;
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

/// <summary>
///     One open document as the bridge reads it live on every snapshot.
///     <c>OpenId</c> is the payload tracker's id (SDK <c>TrackedDocument.OpenId</c>): the only id a route
///     <c>?target=</c> accepts. It is not the id <c>pe-revit doc open</c> prints.
///     <c>Address</c> is the cloud model GUID or absolute path; null until the document is saved
///     (detached, new, or opened by <c>EditFamily</c>). The address follows SaveAs; <c>OpenId</c> does not change.
/// </summary>
public sealed record BridgeDocumentSnapshot(
    string OpenId,
    string Title,
    string? Address,
    bool IsFamilyDocument,
    bool IsActive
);

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
    string? SharedParametersFilename,
    List<BridgeDocumentSnapshot> OpenDocuments,
    List<HostRuntimeAssemblyData> RuntimeAssemblies
);

// Vocabulary: a SESSION is one Revit process incarnation; a CONNECTION is one WS attachment to it.
// The broker (TS host) derives the universal session id from hash(pid + processStartUtc); the
// optional fields below are selectors/metadata (lane, sdkSessionId, buildStamp), never identity.
//
// SdkSessionId is the id `pe-revit session status` prints for this session (SessionRow.id) — the
// name is QUALIFIED because the unqualified `sessionId` on this wire already means the BROKER's
// hash. It replaced `sandboxId` at SDK beta.121, which retired the sandbox noun everywhere and
// renamed the receipt field to `sessionId`. That is a wire rename, not an additive optional, and
// the version gate is exact-match — hence 19 -> 20.
public sealed record BridgeRegistrationRequest(
    int ContractVersion,
    int ProcessId,
    BridgeStateSnapshot State,
    long? ProcessStartUtcUnixMs = null,
    string? SessionDescriptorPath = null,
    string? Lane = null,
    string? SdkSessionId = null,
    string? BuildStamp = null
);

public sealed record BridgeRegistrationAck(
    bool Accepted,
    string? ErrorMessage = null,
    string? SessionId = null
);

public sealed record BridgeStateSync(
    BridgeStateSnapshot State
);

public sealed record BridgeRequest(
    string RequestId,
    string OperationKey,
    string PayloadJson,
    string? OpenDocumentId = null
);

public sealed record BridgeResponse(
    string RequestId,
    bool Ok,
    string? PayloadJson,
    string? ErrorMessage,
    int? StatusCode,
    List<ValidationIssue>? Issues,
    PerformanceMetrics Metrics,
    string? OpenDocumentId = null
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
