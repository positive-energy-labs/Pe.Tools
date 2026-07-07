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

/// <summary>
///     A requested parameter read plus its write surface (all write-surface fields null when the
///     parameter was not found):
///     ParameterId — raw parameter handle (Parameter.Id) usable as the write target for
///     parameter-apply operations; type-ness of the resolved value is already carried by Source
///     (Instance vs Type).
///     RawValue — invariant raw value: String as-is, Integer invariant, Double G17 in internal
///     units, ElementId as long.
///     IsReadOnly — from Parameter.IsReadOnly ONLY; deliberately not derived from
///     Parameter.UserModifiable, which reports false for writable built-ins (Mark, Type Comments)
///     whose Set() succeeds — proven in ScheduleCellBindingProofTests.
/// </summary>
public record RequestedElementParameterValue(
    ParameterDefinitionDescriptor Definition,
    bool Found,
    bool IsBlank,
    string? Value,
    string? DisplayValue,
    RequestedParameterStorageType StorageType,
    RequestedParameterValueSource Source,
    long? ParameterId = null,
    string? RawValue = null,
    bool? IsReadOnly = null
) {
    public string Name => this.Definition.Identity.Name;
    public ParameterIdentity Identity => this.Definition.Identity;
}
