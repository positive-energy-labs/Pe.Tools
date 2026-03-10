using TypeGen.Core.TypeAnnotations;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Client event names emitted by SignalR hubs/services.
/// </summary>
[ExportTsClass]
public static class HubClientEventNames {
    public const string DocumentChanged = nameof(DocumentChanged);
}

/// <summary>
///     SignalR hub method names exposed by <see cref="Hubs.SettingsEditorHub" />.
///     Exported so external clients do not hand-maintain invoke strings.
/// </summary>
[ExportTsClass]
public static class HubMethodNames {
    public const string GetServerCapabilitiesEnvelope = nameof(GetServerCapabilitiesEnvelope);
    public const string GetSchemaEnvelope = nameof(GetSchemaEnvelope);
    public const string GetFieldOptionsEnvelope = nameof(GetFieldOptionsEnvelope);
    public const string ValidateSettingsEnvelope = nameof(ValidateSettingsEnvelope);
    public const string GetParameterCatalogEnvelope = nameof(GetParameterCatalogEnvelope);
    public const string GetSettingsCatalogEnvelope = nameof(GetSettingsCatalogEnvelope);
}

/// <summary>
///     SignalR transport constants for the external settings-editor frontend.
/// </summary>
[ExportTsClass]
public static class HubRoutes {
    public const string SettingsEditor = "/hubs/settings-editor";
}

/// <summary>
///     Stable transport metadata for frontend/backend compatibility checks.
/// </summary>
[ExportTsClass]
public static class SettingsEditorProtocol {
    public const string Transport = "signalr";
    public const int ContractVersion = 2;
}

// =============================================================================
// Schema Hub Messages
// =============================================================================

/// <summary>
///     Request to get a JSON schema for a module.
/// </summary>
[ExportTsInterface]
public record SchemaRequest(string ModuleKey);

/// <summary>
///     Request to get normalized field options for a specific property/source pair.
/// </summary>
[ExportTsInterface]
public record FieldOptionsRequest(
    string ModuleKey,
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

/// <summary>
///     Schema descriptor for field-option dependencies used by render-schema consumers.
/// </summary>
[ExportTsInterface]
public record FieldOptionsDependencySchema(
    string Key,
    FieldOptionsDependencyScope Scope
);

/// <summary>
///     Schema descriptor for a field's remote option source used in render schemas.
/// </summary>
[ExportTsInterface]
public record FieldOptionsSourceSchema(
    string Key,
    FieldOptionsResolverKind Resolver,
    FieldOptionsDatasetKind? Dataset,
    FieldOptionsMode Mode,
    bool AllowsCustomValue,
    List<FieldOptionsDependencySchema> DependsOn
);

// =============================================================================
// Settings Hub Messages
// =============================================================================

/// <summary>
///     Module-owned settings catalog item for frontend target selection.
/// </summary>
[ExportTsInterface]
public record SettingsCatalogItem(
    string Id,
    string Label,
    string ModuleKey,
    string DefaultSubDirectory
);

/// <summary>
///     Canonical descriptor for a backend-registered settings module.
/// </summary>
[ExportTsInterface]
public record SettingsModuleDescriptor(
    string ModuleKey,
    string DefaultSubDirectory,
    string SettingsTypeName,
    string SettingsTypeFullName
);

/// <summary>
///     Backend-owned feature/capability metadata for the settings-editor transport.
/// </summary>
[ExportTsInterface]
public record ServerCapabilitiesData(
    int ContractVersion,
    string Transport,
    string? ServerVersion,
    bool SupportsFragmentSchema,
    bool SupportsRichInvalidationPayload,
    bool SupportsFieldOptionDatasets,
    List<FieldOptionsDatasetKind> SupportedDatasets,
    List<SettingsModuleDescriptor> AvailableModules
);

/// <summary>
///     Request to list available module settings targets.
/// </summary>
[ExportTsInterface]
public record SettingsCatalogRequest(
    string? ModuleKey = null
);

/// <summary>
///     Structured invalidation payload emitted on document-sensitive changes.
/// </summary>
[ExportTsInterface]
public record DocumentInvalidationEvent(
    DocumentInvalidationReason Reason,
    string? DocumentTitle,
    bool HasActiveDocument,
    bool InvalidateFieldOptions,
    bool InvalidateCatalogs,
    bool InvalidateSchema
);

/// <summary>
///     Request to validate settings JSON for a settings type.
/// </summary>
[ExportTsInterface]
public record ValidateSettingsRequest(
    string ModuleKey,
    string SettingsJson
);

/// <summary>
///     Structured validation issue that can be mapped to a UI field.
/// </summary>
[ExportTsInterface]
public record ValidationIssue(
    string InstancePath,
    string? SchemaPath,
    string Code,
    string Severity,
    string Message,
    string? Suggestion
);

// =============================================================================
// Envelope Contracts
// =============================================================================

/// <summary>
///     Unified status codes for all envelope responses.
/// </summary>
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

/// <summary>
///     Envelope-friendly render schema payload.
/// </summary>
[ExportTsInterface]
public record SchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
);

/// <summary>
///     Envelope response for schema requests.
/// </summary>
[ExportTsInterface]
public record SchemaEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    SchemaData? Data
);

/// <summary>
///     Option item for schema-driven field rendering.
/// </summary>
[ExportTsInterface]
public record FieldOptionItem(
    string Value,
    string Label,
    string? Description
);

/// <summary>
///     Envelope-friendly normalized field options payload.
/// </summary>
[ExportTsInterface]
public record FieldOptionsData(
    string SourceKey,
    FieldOptionsMode Mode,
    bool AllowsCustomValue,
    List<FieldOptionItem> Items
);

/// <summary>
///     Envelope response for field options requests.
/// </summary>
[ExportTsInterface]
public record FieldOptionsEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    FieldOptionsData? Data
);

/// <summary>
///     Envelope-friendly validation payload.
/// </summary>
[ExportTsInterface]
public record ValidationData(
    bool IsValid,
    List<ValidationIssue> Issues
);

/// <summary>
///     Envelope response for validation requests.
/// </summary>
[ExportTsInterface]
public record ValidationEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ValidationData? Data
);

/// <summary>
///     Envelope response for server capability requests.
/// </summary>
[ExportTsInterface]
public record ServerCapabilitiesEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ServerCapabilitiesData? Data
);

/// <summary>
///     Request for a richer parameter catalog used by mapping UIs.
/// </summary>
[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? ContextValues
);

/// <summary>
///     Rich catalog entry for client-side parameter filtering.
/// </summary>
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

/// <summary>
///     Envelope-friendly parameter catalog payload with summary counts.
/// </summary>
[ExportTsInterface]
public record ParameterCatalogData(
    List<ParameterCatalogEntry> Entries,
    int FamilyCount,
    int TypeCount
);

/// <summary>
///     Envelope response for parameter catalog requests.
/// </summary>
[ExportTsInterface]
public record ParameterCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ParameterCatalogData? Data
);

/// <summary>
///     Envelope-friendly settings target catalog payload.
/// </summary>
[ExportTsInterface]
public record SettingsCatalogData(
    List<SettingsCatalogItem> Targets
);

/// <summary>
///     Envelope response for settings-catalog requests.
/// </summary>
[ExportTsInterface]
public record SettingsCatalogEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    SettingsCatalogData? Data
);

