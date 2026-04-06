using System.Collections.Concurrent;

namespace Pe.Shared.StorageRuntime.Json.SchemaDefinitions;

public interface ISettingsSchemaDefinitionRegistry {
    bool TryGet(Type settingsType, out SettingsSchemaDefinitionDescriptor definition);
    bool TryResolveDatasetBinding(string datasetId, out SettingsSchemaDatasetBinding binding);
    void Register(ISettingsSchemaDefinition definition);
}

public sealed class SettingsSchemaDefinitionRegistry : ISettingsSchemaDefinitionRegistry {
    private readonly ConcurrentDictionary<Type, SettingsSchemaDefinitionDescriptor> _definitions = new();

    public static SettingsSchemaDefinitionRegistry Shared { get; } = new();

    public bool TryGet(Type settingsType, out SettingsSchemaDefinitionDescriptor definition) =>
        this._definitions.TryGetValue(settingsType, out definition!);

    public bool TryResolveDatasetBinding(string datasetId, out SettingsSchemaDatasetBinding binding) {
        binding = default!;
        if (string.IsNullOrWhiteSpace(datasetId))
            return false;

        var matches = this._definitions.Values
            .Select(definition =>
                definition.Datasets.TryGetValue(datasetId, out var resolvedBinding) ? resolvedBinding : null)
            .Where(item => item != null)
            .Cast<SettingsSchemaDatasetBinding>()
            .ToList();
        if (matches.Count == 0)
            return false;
        if (matches.Count > 1 && !matches.Skip(1).All(match => AreEquivalent(matches[0], match))) {
            throw new InvalidOperationException(
                $"Dataset '{datasetId}' is declared multiple times with conflicting definitions."
            );
        }

        binding = matches[0];
        return true;
    }

    public void Register(ISettingsSchemaDefinition definition) {
        if (definition == null)
            throw new ArgumentNullException(nameof(definition));
        var descriptor = definition.Build();
        this._definitions[descriptor.SettingsType] = descriptor;
    }

    private static bool AreEquivalent(
        SettingsSchemaDatasetBinding left,
        SettingsSchemaDatasetBinding right
    ) =>
        string.Equals(left.Id, right.Id, StringComparison.OrdinalIgnoreCase) &&
        string.Equals(left.Provider, right.Provider, StringComparison.OrdinalIgnoreCase) &&
        left.LoadMode == right.LoadMode &&
        left.StaleOn.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .SequenceEqual(right.StaleOn.OrderBy(value => value, StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase) &&
        left.SupportedProjections.OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
            .SequenceEqual(
                right.SupportedProjections.OrderBy(value => value, StringComparer.OrdinalIgnoreCase),
                StringComparer.OrdinalIgnoreCase
            );
}