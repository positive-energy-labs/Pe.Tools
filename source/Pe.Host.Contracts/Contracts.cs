using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Host.Contracts;

[ExportTsClass]
public static class HubClientEventNames {
    public const string DocumentChanged = nameof(DocumentChanged);
}

[ExportTsClass]
public static class HubMethodNames {
    public const string GetHostStatusEnvelope = nameof(GetHostStatusEnvelope);
    public const string GetSchemaEnvelope = nameof(GetSchemaEnvelope);
    public const string GetFieldOptionsEnvelope = nameof(GetFieldOptionsEnvelope);
    public const string ValidateSettingsEnvelope = nameof(ValidateSettingsEnvelope);
    public const string GetParameterCatalogEnvelope = nameof(GetParameterCatalogEnvelope);
    public const string GetSettingsCatalogEnvelope = nameof(GetSettingsCatalogEnvelope);
}

[ExportTsClass]
public static class HubRoutes {
    public const string Default = "/hubs/settings-editor";
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "signalr";
    public const int ContractVersion = 2;
}

public static class BridgeProtocol {
    public const string Transport = "named-pipes";
    public const int ContractVersion = 1;
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

[ExportTsInterface]
public record SchemaRequest(string ModuleKey);

[ExportTsInterface]
public record FieldOptionsRequest(
    string ModuleKey,
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsInterface]
public record FieldOptionsDependencySchema(
    string Key,
    FieldOptionsDependencyScope Scope
);

[ExportTsInterface]
public record FieldOptionsSourceSchema(
    string Key,
    FieldOptionsResolverKind Resolver,
    FieldOptionsDatasetKind? Dataset,
    FieldOptionsMode Mode,
    bool AllowsCustomValue,
    List<FieldOptionsDependencySchema> DependsOn
);

[ExportTsInterface]
public record SettingsCatalogItem(
    string Id,
    string Label,
    string ModuleKey,
    string DefaultSubDirectory
);

[ExportTsInterface]
public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultSubDirectory,
    string SettingsTypeName,
    string SettingsTypeFullName
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
    List<SettingsModuleDescriptor> AvailableModules,
    string? DisconnectReason
);

[ExportTsInterface]
public record SettingsCatalogRequest(
    string? ModuleKey = null
);

[ExportTsInterface]
public record DocumentInvalidationEvent(
    DocumentInvalidationReason Reason,
    string? DocumentTitle,
    bool HasActiveDocument,
    bool InvalidateFieldOptions,
    bool InvalidateCatalogs,
    bool InvalidateSchema
);

[ExportTsInterface]
public record ValidateSettingsRequest(
    string ModuleKey,
    string SettingsJson
);

[ExportTsInterface]
public record ValidationIssue(
    string InstancePath,
    string? SchemaPath,
    string Code,
    string Severity,
    string Message,
    string? Suggestion
);

[ExportTsEnum]
public enum EnvelopeCode {
    Ok,
    Failed,
    WithErrors,
    NoDocument,
    Exception
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FieldOptionsDependencyScope {
    Sibling,
    Context
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FieldOptionsMode {
    Suggestion,
    Constraint
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FieldOptionsResolverKind {
    Remote,
    Dataset
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FieldOptionsDatasetKind {
    ParameterCatalog
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum DocumentInvalidationReason {
    Opened,
    Closed,
    Changed
}

[ExportTsInterface]
public record SchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
);

[ExportTsInterface]
public record SchemaEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    SchemaData? Data
);

[ExportTsInterface]
public record FieldOptionItem(
    string Value,
    string Label,
    string? Description
);

[ExportTsInterface]
public record FieldOptionsData(
    string SourceKey,
    FieldOptionsMode Mode,
    bool AllowsCustomValue,
    List<FieldOptionItem> Items
);

[ExportTsInterface]
public record FieldOptionsEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    FieldOptionsData? Data
);

[ExportTsInterface]
public record ValidationData(
    bool IsValid,
    List<ValidationIssue> Issues
);

[ExportTsInterface]
public record ValidationEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ValidationData? Data
);

[ExportTsInterface]
public record HostStatusEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    HostStatusData? Data
);

[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues
);

[ExportTsInterface]
public record ParameterCatalogEntry(
    string Name,
    string StorageType,
    string? DataType,
    bool IsShared,
    bool IsInstance,
    bool IsBuiltIn,
    bool IsProjectParameter,
    bool IsParamService,
    string? SharedGuid,
    List<string> FamilyNames,
    List<string> TypeNames
);

[ExportTsInterface]
public record ParameterCatalogData(
    List<ParameterCatalogEntry> Entries,
    int FamilyCount,
    int TypeCount
);

[ExportTsInterface]
public record ParameterCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ParameterCatalogData? Data
);

[ExportTsInterface]
public record SettingsCatalogData(
    List<SettingsCatalogItem> Targets
);

[ExportTsInterface]
public record SettingsCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    SettingsCatalogData? Data
);

public record BridgeHandshake(
    int ContractVersion,
    string Transport,
    string RevitVersion,
    string RuntimeFramework,
    bool HasActiveDocument,
    string? ActiveDocumentTitle,
    List<SettingsModuleDescriptor> AvailableModules
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
