using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Operations;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.Protocol;

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
    public const string ScriptingBase = "/api/scripting";
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
    public static readonly string ScheduleProfilesQuery = GetScheduleProfilesQueryOperationContract.Definition.Route;
    public static readonly string ScheduleQuery = GetScheduleQueryOperationContract.Definition.Route;
    public static readonly string LoadedFamiliesCatalog = GetLoadedFamiliesCatalogOperationContract.Definition.Route;
    public static readonly string LoadedFamiliesMatrix = GetLoadedFamiliesMatrixOperationContract.Definition.Route;

    public static readonly string ProjectParameterBindings =
        GetProjectParameterBindingsOperationContract.Definition.Route;

    public static readonly string ElementContextQuery =
        GetElementContextQueryOperationContract.Definition.Route;

    public static readonly string ElectricalPanelsCatalog =
        GetElectricalPanelsCatalogOperationContract.Definition.Route;

    public static readonly string ElectricalCircuitsCatalog =
        GetElectricalCircuitsCatalogOperationContract.Definition.Route;

    public static readonly string ElectricalPanelSchedulesQuery =
        GetElectricalPanelSchedulesQueryOperationContract.Definition.Route;

    public static readonly string ElectricalLoadClassificationsCatalog =
        GetElectricalLoadClassificationsCatalogOperationContract.Definition.Route;

    public static readonly string DocumentContext =
        GetRevitDocumentSessionContextOperationContract.Definition.Route;

    public static readonly string ScriptingWorkspaceBootstrap =
        GetScriptWorkspaceBootstrapOperationContract.Definition.Route;

    public static readonly string ScriptingExecute =
        ExecuteRevitScriptOperationContract.Definition.Route;
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "http+sse";
    public const int ContractVersion = 29;
}

public interface IBridgeSessionRequest {
    BridgeSessionSelector? Target { get; }
}

[ExportTsInterface]
public record BridgeSessionSelector(
    string? SessionId,
    string? RevitVersion
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostInvalidationDomain {
    SettingsFieldOptions,
    SettingsParameterCatalog,
    ScheduleCatalog,
    ScheduleProfilesQuery,
    ScheduleQuery,
    LoadedFamiliesCatalog,
    LoadedFamiliesMatrix,
    ProjectParameterBindings,
    LoadedFamiliesFilterFieldOptions,
    ElementContextQuery,
    ElectricalPanelsCatalog,
    ElectricalCircuitsCatalog,
    ElectricalPanelSchedulesQuery,
    ElectricalLoadClassificationsCatalog
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
public record HostSessionData(
    string SessionId,
    string RevitVersion,
    int ProcessId,
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
    string? RuntimeFramework,
    int BridgeContractVersion,
    string BridgeTransport,
    List<HostModuleDescriptor> AvailableModules,
    long ConnectedAtUnixMs
);

[ExportTsInterface]
public record HostStatusData(
    bool HostIsRunning,
    bool BridgeIsConnected,
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
    string? RevitVersion,
    string? RuntimeFramework,
    int HostContractVersion,
    string HostTransport,
    string RuntimeIdentity,
    string PipeName,
    string? ServerVersion,
    int BridgeContractVersion,
    string BridgeTransport,
    List<HostModuleDescriptor> CatalogModules,
    string? DisconnectReason,
    string? DefaultSessionId,
    long HostObservedAtUnixMs,
    List<HostSessionData> Sessions
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
    List<HostInvalidationDomain> InvalidatedDomains,
    string? SessionId = null,
    string? RevitVersion = null
);

[ExportTsInterface]
public record HostStatusChangedEvent(
    HostStatusChangedReason Reason,
    bool HasActiveDocument,
    string? DocumentTitle,
    string? DocumentKey,
    string? DocumentPath,
    bool DocumentIsFamilyDocument,
    bool DocumentIsWorkshared,
    bool DocumentIsModelInCloud,
    string? DocumentCloudProjectGuid,
    string? DocumentCloudModelGuid,
    string? DocumentCloudModelUrn,
    int OpenDocumentCount,
    long DocumentObservedAtUnixMs,
    string? SessionId = null,
    string? RevitVersion = null,
    int ConnectedSessionCount = 0
);