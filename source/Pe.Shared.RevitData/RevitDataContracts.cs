using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RevitDataIssueSeverity {
    Info,
    Warning,
    Error
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RequestedParameterStorageType {
    None,
    String,
    Integer,
    Double,
    ElementId
}

[ExportTsSchema]
public record RevitDataIssue(
    string Code,
    RevitDataIssueSeverity Severity,
    string Message,
    string? FamilyName = null,
    string? TypeName = null,
    string? ParameterName = null
);
