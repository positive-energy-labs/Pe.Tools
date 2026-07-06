using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
public enum ElementIdentitySource {
    None,
    RequestedParameter,
    Mark
}

public record RequestedParameterQuery {
    public List<ParameterReference> Parameters { get; init; } = [];
}

[JsonConverter(typeof(StringEnumConverter))]
public enum RequestedParameterValueSource {
    None,
    Instance,
    Type
}

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
