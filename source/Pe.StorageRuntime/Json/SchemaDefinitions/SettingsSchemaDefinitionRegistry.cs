using System.Collections.Concurrent;

namespace Pe.StorageRuntime.Json.SchemaDefinitions;

public interface ISettingsSchemaDefinitionRegistry {
    bool TryGet(Type settingsType, out SettingsSchemaDefinitionDescriptor definition);
    void Register(ISettingsSchemaDefinition definition);
}

public sealed class SettingsSchemaDefinitionRegistry : ISettingsSchemaDefinitionRegistry {
    private readonly ConcurrentDictionary<Type, SettingsSchemaDefinitionDescriptor> _definitions = new();

    public static SettingsSchemaDefinitionRegistry Shared { get; } = new();

    public bool TryGet(Type settingsType, out SettingsSchemaDefinitionDescriptor definition) =>
        this._definitions.TryGetValue(settingsType, out definition!);

    public void Register(ISettingsSchemaDefinition definition) {
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));
        var descriptor = definition.Build();
        this._definitions[descriptor.SettingsType] = descriptor;
    }
}
