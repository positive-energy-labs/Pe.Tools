using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.HostContracts.SettingsStorage;

[ExportTsSchema]
public record SchemaRequest(
    string ModuleKey,
    string RootKey
);

[ExportTsSchema]
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

[ExportTsSchema]
public record ValidationIssue(
    string InstancePath,
    string? SchemaPath,
    string Code,
    string Severity,
    string Message,
    string? Suggestion
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum FieldOptionsMode {
    Suggestion,
    Constraint
}

[ExportTsSchema]
public record SchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
);

[ExportTsSchema]
public record FieldOptionItem(
    string Value,
    string Label,
    string? Description
);

[ExportTsSchema]
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
