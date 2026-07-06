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

public record ValidateSettingsRequest(
    string ModuleKey,
    string SettingsJson
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
    string? Description
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
