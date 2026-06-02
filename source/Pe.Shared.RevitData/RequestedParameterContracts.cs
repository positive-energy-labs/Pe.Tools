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
    public List<ParameterReference> Parameters { get; init; } = [];
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum RequestedParameterValueSource {
    None,
    Instance,
    Type
}

[ExportTsInterface]
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
