using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RevitDataIssueSeverity {
    Info,
    Warning,
    Error
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RequestedParameterStorageType {
    None,
    String,
    Integer,
    Double,
    ElementId
}

[ExportTsInterface]
public record RevitDataIssue(
    string Code,
    RevitDataIssueSeverity Severity,
    string Message,
    string? FamilyName = null,
    string? TypeName = null,
    string? ParameterName = null
);
