using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.Protocol;

public static class SettingsHostEventNames {
    public const string DocumentChanged = "document-changed";
}

public static class HttpRoutes {
    public const string Bridge = "/api/bridge";
}

public static class HostProtocol {
    // 36: loaded-families matrix reshaped to FamilySnapshotRecord (canonical family record language)
    // 37: schedule query rows gain optional cell bindings (write surface: includeBindings projection)
    // 38: revit.apply.parameter-values op (redeem binding handles) + element-detail parameter editability
    // 39: parameter-values unit-aware conversion (value + unit canonical; bare numerals on
    //     measurable doubles rejected as ambiguous; parsedDisplay round-trip echo)
    // 40: model-owned parameter-link detail/apply operations and shared profile language
    public const int ContractVersion = 40;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DocumentInvalidationReason {
    Opened,
    Closed,
    Changed
}

[JsonConverter(typeof(StringEnumConverter))]
public enum HostModuleScope {
    Host,
    Session,
    ActiveDocument
}

[JsonConverter(typeof(StringEnumConverter))]
public enum HostModuleActiveDocumentKind {
    Any,
    ProjectOnly,
    FamilyOnly
}

public record HostModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    HostModuleScope Scope,
    HostModuleActiveDocumentKind ActiveDocumentKind
);

public record HostProbeData(
    string RuntimeIdentity,
    int HostContractVersion,
    int BridgeContractVersion,
    string BridgePath,
    bool BridgeIsConnected,
    string? DisconnectReason
);

public record HostRuntimeAssemblyData(
    string Name,
    string? Version,
    string? InformationalVersion,
    string? Location,
    string ModuleVersionId
);

public record DocumentInvalidationEvent(
    DocumentInvalidationReason Reason,
    string? DocumentTitle,
    string? DocumentKey,
    string? DocumentPath,
    bool DocumentIsFamilyDocument,
    bool DocumentIsWorkshared,
    bool DocumentIsModelInCloud,
    string? DocumentCloudProjectGuid,
    string? DocumentCloudModelGuid,
    string? DocumentCloudModelUrn,
    bool HasActiveDocument,
    int OpenDocumentCount,
    long DocumentObservedAtUnixMs,
    string? RevitVersion = null
);
