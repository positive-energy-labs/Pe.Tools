using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.HostContracts.Protocol;

public static class SettingsHostEventNames {
    public const string DocumentChanged = "document-changed";
}

public static class HttpRoutes {
    public const string Bridge = "/api/bridge";
}

public static class HostProtocol {
    public const int ContractVersion = 35;
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DocumentInvalidationReason {
    Opened,
    Closed,
    Changed
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum HostModuleScope {
    Host,
    Session,
    ActiveDocument
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
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
