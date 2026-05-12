using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.Protocol;

[ExportTsClass]
public static class SettingsHostEventNames {
    public const string DocumentChanged = "document-changed";
    public const string SessionConnectionChanged = "session-connection-changed";
}

[ExportTsClass]
public static class HttpRoutes {
    public const string ApsBase = "/api/aps";
    public const string SettingsBase = "/api/settings";
    public const string RevitDataBase = "/api/revit-data";
    public const string ScriptingBase = "/api/scripting";
    public const string Bridge = "/api/bridge";
    public const string Events = SettingsBase + "/events";
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "http+sse";
    public const int ContractVersion = 33;
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostSessionConnectionChangeReason {
    BridgeRegistered,
    BridgeRejected,
    BridgeDisconnected,
    BridgeStateSynchronized,
    ActiveDocumentChanged
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum DocumentInvalidationReason {
    Opened,
    Closed,
    Changed
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostModuleScope {
    Host,
    Session,
    ActiveDocument
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostModuleActiveDocumentKind {
    Any,
    ProjectOnly,
    FamilyOnly
}

[ExportTsInterface]
public record HostModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    HostModuleScope Scope,
    HostModuleActiveDocumentKind ActiveDocumentKind
);

[ExportTsInterface]
public record HostActiveDocumentSummary(
    string? Title,
    string? Key,
    string? Path,
    bool IsFamilyDocument,
    bool IsWorkshared,
    bool IsModelInCloud,
    string? CloudProjectGuid,
    string? CloudModelGuid,
    string? CloudModelUrn,
    long ObservedAtUnixMs
);

[ExportTsInterface]
public record HostProbeData(
    string RuntimeIdentity,
    int HostContractVersion,
    int BridgeContractVersion,
    string BridgePath,
    bool BridgeIsConnected,
    string? DisconnectReason
);

[ExportTsInterface]
public record HostSessionSummaryData(
    bool BridgeIsConnected,
    string? SessionId,
    int? ProcessId,
    string? RevitVersion,
    string? RuntimeFramework,
    int OpenDocumentCount,
    HostActiveDocumentSummary? ActiveDocument,
    IReadOnlyList<HostModuleDescriptor> AvailableModules
);

[ExportTsInterface]
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
    string? SessionId = null,
    string? RevitVersion = null
);

[ExportTsInterface]
public record HostSessionConnectionChangedEvent(
    HostSessionConnectionChangeReason Reason,
    bool BridgeIsConnected,
    string? SessionId,
    int? ProcessId,
    string? RevitVersion,
    string? RuntimeFramework,
    int OpenDocumentCount,
    string? DisconnectReason = null
);
