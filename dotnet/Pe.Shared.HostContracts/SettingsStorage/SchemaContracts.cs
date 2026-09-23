using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Shared.HostContracts.SettingsStorage;

/// <summary>A settings library addressed by the `$schema` URL its specs carry.</summary>
public record SchemaRequest(string SchemaUrl);

/// <summary>
///     The one field-options read: a value-domain key (an <c>x-options.key</c>) and the context
///     values its <c>dependsOn</c> names.
/// </summary>
public record FieldOptionsRequest(
    string Key,
    Dictionary<string, string>? Context = null
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
public enum FieldOptionsResultKind {
    Success,
    Unsupported,
    Failure
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

public record FieldOptionsResult(FieldOptionsResultKind Kind, string Message);

public record FieldOptionsData(
    SettingsValueDomainDescriptor Descriptor,
    List<FieldOptionItem> Items,
    FieldOptionsResult Result
);

public record ValidationData(
    bool IsValid,
    List<ValidationIssue> Issues
);

public record SettingsValidateData(
    bool IsConfigured,
    List<ValidationIssue> Issues
);
