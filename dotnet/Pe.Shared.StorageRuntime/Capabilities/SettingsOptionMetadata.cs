using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace Pe.Shared.StorageRuntime.Capabilities;

public enum SettingsOptionsMode {
    Suggestion,
    Constraint
}

public enum SettingsOptionsDependencyScope {
    Sibling,
    Context
}

public sealed record SettingsOptionsDependency(
    string Key,
    SettingsOptionsDependencyScope Scope
);

// Single source of truth for a field's options source: the runtime descriptor is also the
// x-options payload every schema writer emits and the descriptor the field-options read returns.
public sealed record SettingsValueDomainDescriptor(
    string Key,
    SettingsOptionsMode Mode,
    bool AllowsCustomValue,
    IReadOnlyList<SettingsOptionsDependency> DependsOn,
    SettingsRuntimeMode RequiredRuntimeMode
) {
    private static readonly JsonSerializer Serializer = JsonSerializer.CreateDefault(new JsonSerializerSettings {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
        Converters = [new StringEnumConverter()]
    });

    /// <summary>The x-options node: `{ key, mode, allowsCustomValue, dependsOn, requiredRuntimeMode }`.</summary>
    public JObject ToOptionsPayload() => JObject.FromObject(this, Serializer);
}
