using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.Protocol;

public static class BridgeProtocol {
    public const string Transport = "named-pipes";
    public const int ContractVersion = 10;
    public const string DefaultPipeName = "Pe.Host.Bridge";
}

[JsonConverter(typeof(StringEnumConverter))]
public enum BridgeFrameKind {
    Handshake,
    Request,
    Response,
    Event,
    Disconnect
}

public record BridgeHandshake(
    int ContractVersion,
    string Transport,
    string RevitVersion,
    string RuntimeFramework,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    List<HostModuleDescriptor> AvailableModules
);

public record BridgeRequest(
    string RequestId,
    string Method,
    string PayloadJson,
    long SentAtUnixMs,
    int PayloadBytes
);

public record BridgeResponse(
    string RequestId,
    bool Ok,
    string? PayloadJson,
    string? ErrorMessage,
    PerformanceMetrics Metrics
);

public record BridgeEvent(
    string EventName,
    string PayloadJson
);

public record PerformanceMetrics(
    long RoundTripMs,
    long RevitExecutionMs,
    long SerializationMs,
    int RequestBytes,
    int ResponseBytes
);

public record BridgeFrame(
    BridgeFrameKind Kind,
    BridgeHandshake? Handshake = null,
    BridgeRequest? Request = null,
    BridgeResponse? Response = null,
    BridgeEvent? Event = null,
    string? DisconnectReason = null
);