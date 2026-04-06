using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.HostContracts.Operations;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.SettingsStorage;

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
) : IHostDataEnvelope<SchemaData> {
    public object? GetData() => this.Data;
}

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
) : IHostDataEnvelope<FieldOptionsData> {
    public object? GetData() => this.Data;
}

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
) : IHostDataEnvelope<ValidationData> {
    public object? GetData() => this.Data;
}
