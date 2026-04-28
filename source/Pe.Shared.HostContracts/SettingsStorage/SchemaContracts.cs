using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.SettingsStorage;

[ExportTsInterface]
public record SchemaRequest(
    string ModuleKey,
    string RootKey
);

[ExportTsInterface]
public record FieldOptionsRequest(
    string ModuleKey,
    string RootKey,
    string PropertyPath,
    string SourceKey,
    Dictionary<string, string>? ContextValues
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

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum FieldOptionsMode {
    Suggestion,
    Constraint
}

[ExportTsInterface]
public record SchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
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
public record ValidationData(
    bool IsValid,
    List<ValidationIssue> Issues
);
