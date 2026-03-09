using TypeGen.Core.TypeAnnotations;

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
    public const string GetSchemaEnvelope = nameof(GetSchemaEnvelope);
    public const string GetExamplesEnvelope = nameof(GetExamplesEnvelope);
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

// =============================================================================
// Schema Hub Messages
// =============================================================================

/// <summary>
///     Request to get a JSON schema for a module.
/// </summary>
[ExportTsInterface]
public record SchemaRequest(string ModuleKey);

/// <summary>
///     Request to get examples for a specific property, with optional sibling filtering.
/// </summary>
[ExportTsInterface]
public record ExamplesRequest(
    string ModuleKey,
    string PropertyPath,
    Dictionary<string, string>? SiblingValues
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
///     Request to list available module settings targets.
/// </summary>
[ExportTsInterface]
public record SettingsCatalogRequest(
    string? ModuleKey = null
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
///     Envelope-friendly examples payload.
/// </summary>
[ExportTsInterface]
public record ExamplesData(
    List<string> Examples
);

/// <summary>
///     Envelope response for examples requests.
/// </summary>
[ExportTsInterface]
public record ExamplesEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    ExamplesData? Data
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
///     Request for a richer parameter catalog used by mapping UIs.
/// </summary>
[ExportTsInterface]
public record ParameterCatalogRequest(
    string ModuleKey,
    Dictionary<string, string>? SiblingValues
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

