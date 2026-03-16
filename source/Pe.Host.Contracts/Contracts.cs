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
}

[ExportTsClass]
public static class HostProtocol {
    public const string Transport = "http+sse";
    public const int ContractVersion = 8;
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsFileKind {
    Profile,
    Fragment,
    Schema,
    Other
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsDirectiveScope {
    Local,
    Global
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum SettingsDocumentDependencyKind {
    Include,
    Preset
}

[ExportTsInterface]
public record SettingsDocumentId(
    string ModuleKey,
    string RootKey,
    string RelativePath
) {
    public string StableId => $"{this.ModuleKey}:{this.RootKey}:{this.RelativePath}".ToLowerInvariant();
}

[ExportTsInterface]
public record SettingsVersionToken(string Value);

[ExportTsInterface]
public record SettingsDocumentMetadata(
    SettingsDocumentId DocumentId,
    SettingsFileKind Kind,
    DateTimeOffset? ModifiedUtc,
    SettingsVersionToken? VersionToken
);

[ExportTsInterface]
public record SettingsDocumentDependency(
    SettingsDocumentId DocumentId,
    string DirectivePath,
    SettingsDirectiveScope Scope,
    SettingsDocumentDependencyKind Kind
);

[ExportTsInterface]
public record SettingsValidationIssue(
    string Path,
    string Code,
    string Severity,
    string Message,
    string? Suggestion = null
);

[ExportTsInterface]
public record SettingsValidationResult(
    bool IsValid,
    List<SettingsValidationIssue> Issues
);

[ExportTsInterface]
public record SettingsDocumentSnapshot(
    SettingsDocumentMetadata Metadata,
    string RawContent,
    string? ComposedContent,
    List<SettingsDocumentDependency> Dependencies,
    SettingsValidationResult Validation,
    Dictionary<string, string> CapabilityHints
);

[ExportTsInterface]
public record OpenSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    bool IncludeComposedContent = false
);

[ExportTsInterface]
public record SaveSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent,
    SettingsVersionToken? ExpectedVersionToken = null
);

[ExportTsInterface]
public record ValidateSettingsDocumentRequest(
    SettingsDocumentId DocumentId,
    string RawContent
);

[ExportTsInterface]
public record SaveSettingsDocumentResult(
    SettingsDocumentMetadata Metadata,
    bool WriteApplied,
    bool ConflictDetected,
    string? ConflictMessage,
    SettingsValidationResult Validation
);

[ExportTsInterface]
public record SettingsRootDescriptor(
    string RootKey,
    string DisplayName
);

[ExportTsInterface]
public record SettingsModuleWorkspaceDescriptor(
    string ModuleKey,
    string DefaultRootKey,
    List<SettingsRootDescriptor> Roots
);

[ExportTsInterface]
public record SettingsWorkspaceDescriptor(
    string WorkspaceKey,
    string DisplayName,
    string BasePath,
    List<SettingsModuleWorkspaceDescriptor> Modules
);

[ExportTsInterface]
public record SettingsWorkspacesData(
    List<SettingsWorkspaceDescriptor> Workspaces
);

[ExportTsInterface]
public record SettingsFileEntry(
    string Path,
    string RelativePath,
    string RelativePathWithoutExtension,
    string Name,
    string BaseName,
    string? Directory,
    DateTimeOffset ModifiedUtc,
    SettingsFileKind Kind,
    bool IsFragment,
    bool IsSchema
);

[ExportTsInterface]
public record SettingsFileNode(
    string Name,
    string RelativePath,
    string RelativePathWithoutExtension,
    string Id,
    DateTimeOffset ModifiedUtc,
    SettingsFileKind Kind,
    bool IsFragment,
    bool IsSchema
);

[ExportTsInterface]
public record SettingsDirectoryNode(
    string Name,
    string RelativePath,
    List<SettingsDirectoryNode> Directories,
    List<SettingsFileNode> Files
);

[ExportTsInterface]
public record SettingsDiscoveryResult(
    List<SettingsFileEntry> Files,
    SettingsDirectoryNode Root
);

[ExportTsInterface]
public record SettingsTreeRequest {
    public string ModuleKey { get; init; } = string.Empty;
    public string RootKey { get; init; } = string.Empty;
    public string? SubDirectory { get; init; }
    public bool Recursive { get; init; }
    public bool IncludeFragments { get; init; }
    public bool IncludeSchemas { get; init; }
}

public static class BridgeProtocol {
    public const string Transport = "named-pipes";
    public const int ContractVersion = 3;
    public const string DefaultPipeName = "Pe.Host.Bridge";
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ProviderMode {
    HostOnly,
    BridgeEnhanced
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
    bool InvalidateFieldOptions,
    bool InvalidateCatalogs,
    bool InvalidateSchema
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum HostStatusChangedReason {
    BridgeConnected,
    BridgeDisconnected,
    BridgeHandshakeRefreshed,
    ActiveDocumentChanged
}

[ExportTsInterface]
public record HostStatusChangedEvent(
    HostStatusChangedReason Reason,
    bool HasActiveDocument,
    string? DocumentTitle
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
public enum FieldOptionsMode {
    Suggestion,
    Constraint
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
