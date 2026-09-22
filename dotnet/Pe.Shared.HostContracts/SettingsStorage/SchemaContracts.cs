using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.HostContracts.SettingsStorage;

/// <summary>A settings library addressed by the `$schema` URL its specs carry.</summary>
public record SchemaRequest(string SchemaUrl);

public record FieldOptionsRequest(
    string SchemaUrl,
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

/// <summary>Semantic validation of one spec by the library its `$schema` names; structural validation stays in the host.</summary>
public record SettingsValidateRequest(
    string SchemaUrl,
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

public record SettingsValidateData(
    bool IsConfigured,
    List<ValidationIssue> Issues
);
