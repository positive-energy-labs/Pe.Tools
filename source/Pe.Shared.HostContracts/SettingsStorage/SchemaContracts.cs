using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.SettingsStorage;

public record SchemaRequest(
    string ModuleKey,
    string RootKey
);

public record FieldOptionsRequest(
    string ModuleKey,
    string RootKey,
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
);

/// <summary>
///     Options for a value domain addressed by source key alone — the resolution target for
///     request schema fields annotated with <c>x-options</c> (see FieldOptionsAttribute).
/// </summary>
public record ValueDomainOptionsRequest(
    string SourceKey,
    Dictionary<string, string>? ContextValues = null
);

public record ValidateSettingsRequest(
    string ModuleKey,
    string SettingsJson
);

public record ValidateSettingsDocumentSemanticsRequest(
    string ModuleKey,
    string RootKey,
    string RelativePath,
    string RawContent,
    string ComposedContent
);

public record ValidationIssue(
    string InstancePath,
    string? SchemaPath,
    string Code,
    string Severity,
    string Message,
    string? Suggestion
);

[JsonConverter(typeof(StringEnumConverter))]
public enum FieldOptionsMode {
    Suggestion,
    Constraint
}

public record SchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
);

public record FieldOptionItem(
    string Value,
    string Label,
    string? Description,
    Dictionary<string, string>? Metadata = null
);

public record FieldOptionsData(
    string SourceKey,
    FieldOptionsMode Mode,
    bool AllowsCustomValue,
    List<FieldOptionItem> Items
);

public record ValidationData(
    bool IsValid,
    List<ValidationIssue> Issues
);

public record SettingsDocumentSemanticValidationData(
    bool IsConfigured,
    List<ValidationIssue> Issues
);
