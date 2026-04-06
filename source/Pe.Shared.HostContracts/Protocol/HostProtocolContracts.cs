using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Host.Contracts.Operations;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.Host.Contracts.Protocol;

[ExportTsClass]
public static class SettingsHostEventNames {
    public const string DocumentChanged = "document-changed";
    public const string HostStatusChanged = "host-status-changed";
}

public static class HostRuntimeEventNames {
    public const string Notification = "notification";
}

[ExportTsClass]
public static class HttpRoutes {
    public const string SettingsBase = "/api/settings";

    public const string RevitDataBase = "/api/revit-data";
    public static readonly string HostStatus = GetHostStatusOperationContract.Definition.Route;
    public static readonly string Schema = GetSchemaOperationContract.Definition.Route;
    public static readonly string Workspaces = GetWorkspacesOperationContract.Definition.Route;
    public static readonly string Tree = DiscoverSettingsTreeOperationContract.Definition.Route;
    public static readonly string FieldOptions = GetFieldOptionsOperationContract.Definition.Route;
    public static readonly string ParameterCatalog = GetParameterCatalogOperationContract.Definition.Route;
    public static readonly string OpenDocument = OpenSettingsDocumentOperationContract.Definition.Route;
    public static readonly string ValidateDocument = ValidateSettingsDocumentOperationContract.Definition.Route;
    public static readonly string SaveDocument = SaveSettingsDocumentOperationContract.Definition.Route;
    public static readonly string Events = SettingsBase + "/events";

    public static readonly string LoadedFamiliesFilterSchema =
        GetLoadedFamiliesFilterSchemaOperationContract.Definition.Route;

    public static readonly string LoadedFamiliesFilterFieldOptions =
        GetLoadedFamiliesFilterFieldOptionsOperationContract.Definition.Route;

    public static readonly string ScheduleCatalog = GetScheduleCatalogOperationContract.Definition.Route;
    public static readonly string LoadedFamiliesCatalog = GetLoadedFamiliesCatalogOperationContract.Definition.Route;
    public static readonly string LoadedFamiliesMatrix = GetLoadedFamiliesMatrixOperationContract.Definition.Route;

    public static readonly string ProjectParameterBindings =
        GetProjectParameterBindingsOperationContract.Definition.Route;
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "http+sse";
    public const int ContractVersion = 17;
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostInvalidationDomain {
    SettingsFieldOptions,
    SettingsParameterCatalog,
    ScheduleCatalog,
    LoadedFamiliesCatalog,
    LoadedFamiliesMatrix,
    ProjectParameterBindings,
    LoadedFamiliesFilterFieldOptions
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostStatusChangedReason {
    BridgeConnected,
    BridgeDisconnected,
    BridgeHandshakeRefreshed,
    ActiveDocumentChanged
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum DocumentInvalidationReason {
    Opened,
    Closed,
    Changed
}

[ExportTsInterface]
public record HostModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey
);

[ExportTsInterface]
public record HostStatusData(
    bool HostIsRunning,
    bool BridgeIsConnected,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    string? RevitVersion,
    string? RuntimeFramework,
    int HostContractVersion,
    string HostTransport,
    string? ServerVersion,
    int BridgeContractVersion,
    string BridgeTransport,
    List<HostModuleDescriptor> AvailableModules,
    string? DisconnectReason
);

[ExportTsInterface]
public record DocumentInvalidationEvent(
    DocumentInvalidationReason Reason,
    string? DocumentTitle,
    bool HasActiveDocument,
    List<HostInvalidationDomain> InvalidatedDomains
);

[ExportTsInterface]
public record HostStatusChangedEvent(
    HostStatusChangedReason Reason,
    bool HasActiveDocument,
    string? DocumentTitle
);