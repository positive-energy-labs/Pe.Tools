using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElementIdentitySource {
    None,
    RequestedParameter,
    Mark
}

[ExportTsSchema]
public record RequestedParameterQuery {
    public List<ParameterReference> Parameters { get; init; } = [];
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum RequestedParameterValueSource {
    None,
    Instance,
    Type
}

[ExportTsSchema]
public record RequestedElementParameterValue(
    ParameterDefinitionDescriptor Definition,
    bool Found,
    bool IsBlank,
    string? Value,
    string? DisplayValue,
    RequestedParameterStorageType StorageType,
    RequestedParameterValueSource Source
) {
    public string Name => this.Definition.Identity.Name;
    public ParameterIdentity Identity => this.Definition.Identity;
}
