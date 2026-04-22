using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ElementIdentitySource {
    None,
    RequestedParameter,
    Mark
}

[ExportTsInterface]
public record RequestedParameterQuery {
    public List<string> ParameterNames { get; init; } = [];
}

[ExportTsInterface]
public record RequestedElementParameterValue(
    string Name,
    bool Found,
    string? Value,
    string? DisplayValue,
    RequestedParameterStorageType StorageType
);