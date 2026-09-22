using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum RevitDataIssueSeverity {
    Info,
    Warning,
    Error
}

[JsonConverter(typeof(StringEnumConverter))]
public enum RequestedParameterStorageType {
    None,
    String,
    Integer,
    Double,
    ElementId
}

public record RevitDataIssue(
    string Code,
    RevitDataIssueSeverity Severity,
    string Message,
    string? FamilyName = null,
    string? TypeName = null,
    string? ParameterName = null
);
