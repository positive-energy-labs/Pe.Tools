using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Host.Contracts;

public static class HubMethodNames {
    public const string GetHostStatusEnvelope = nameof(GetHostStatusEnvelope);
    public const string GetSchemaEnvelope = nameof(GetSchemaEnvelope);
    public const string GetFieldOptionsEnvelope = nameof(GetFieldOptionsEnvelope);
    public const string ValidateSettingsEnvelope = nameof(ValidateSettingsEnvelope);
    public const string GetParameterCatalogEnvelope = nameof(GetParameterCatalogEnvelope);
    public const string GetScheduleCatalogEnvelope = nameof(GetScheduleCatalogEnvelope);
    public const string GetLoadedFamiliesCatalogEnvelope = nameof(GetLoadedFamiliesCatalogEnvelope);
    public const string GetLoadedFamiliesMatrixEnvelope = nameof(GetLoadedFamiliesMatrixEnvelope);
    public const string GetProjectParameterBindingsEnvelope = nameof(GetProjectParameterBindingsEnvelope);
}

[ExportTsClass]
public static class SettingsHostEventNames {
    public const string DocumentChanged = "document-changed";
    public const string HostStatusChanged = "host-status-changed";
}

[ExportTsClass]
public static class HttpRoutes {
    public const string SettingsBase = "/api/settings";
    public const string HostStatus = SettingsBase + "/host-status";
    public const string Schema = SettingsBase + "/schema";
    public const string Workspaces = SettingsBase + "/workspaces";
    public const string Tree = SettingsBase + "/tree";
    public const string FieldOptions = SettingsBase + "/field-options";
    public const string ParameterCatalog = SettingsBase + "/parameter-catalog";
    public const string OpenDocument = SettingsBase + "/document/open";
    public const string ComposeDocument = SettingsBase + "/document/compose";
    public const string ValidateDocument = SettingsBase + "/document/validate";
    public const string SaveDocument = SettingsBase + "/document/save";
    public const string Events = SettingsBase + "/events";

    public const string RevitDataBase = "/api/revit-data";
    public const string LoadedFamiliesFilterSchema = RevitDataBase + "/loaded-families/filter/schema";
    public const string LoadedFamiliesFilterFieldOptions = RevitDataBase + "/loaded-families/filter/field-options";
    public const string ScheduleCatalog = RevitDataBase + "/schedules/catalog";
    public const string LoadedFamiliesCatalog = RevitDataBase + "/loaded-families/catalog";
    public const string LoadedFamiliesMatrix = RevitDataBase + "/loaded-families/matrix";
    public const string ProjectParameterBindings = RevitDataBase + "/project-parameter-bindings";
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "http+sse";
    public const int ContractVersion = 15;
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProviderMode {
    HostOnly,
    BridgeEnhanced
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
public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultRootKey
);

[ExportTsInterface]
public record HostStatusData(
    bool HostIsRunning,
    bool BridgeIsConnected,
    ProviderMode ProviderMode,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    string? RevitVersion,
    string? RuntimeFramework,
    int HostContractVersion,
    string HostTransport,
    string? ServerVersion,
    int BridgeContractVersion,
    string BridgeTransport,
    List<SettingsModuleDescriptor> AvailableModules,
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
