using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Modules;
using System.Reflection;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal sealed class SettingsSchemaSyncMetadata(
    IReadOnlyDictionary<string, Type> fragmentItemTypesByRoot,
    IReadOnlyDictionary<string, Type> presetObjectTypesByRoot,
    IReadOnlyCollection<string> knownIncludeRoots,
    IReadOnlyCollection<string> knownPresetRoots
) {
    public IReadOnlyDictionary<string, Type> FragmentItemTypesByRoot { get; } = fragmentItemTypesByRoot;
    public IReadOnlyDictionary<string, Type> PresetObjectTypesByRoot { get; } = presetObjectTypesByRoot;
    public IReadOnlyCollection<string> KnownIncludeRoots { get; } = knownIncludeRoots;
    public IReadOnlyCollection<string> KnownPresetRoots { get; } = knownPresetRoots;
}

internal static class SettingsSchemaSyncMetadataBuilder {
    public static SettingsSchemaSyncMetadata Create(
        Type settingsType,
        SettingsStorageModuleOptions? storageOptions = null
    ) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));

        var options = storageOptions ?? SettingsModulePolicyResolver.CreateStorageOptions(settingsType);
        var fragmentItemTypesByRoot = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase);
        var presetObjectTypesByRoot = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase);
        var knownIncludeRoots = new HashSet<string>(options.IncludeRoots, StringComparer.OrdinalIgnoreCase);
        var knownPresetRoots = new HashSet<string>(options.PresetRoots, StringComparer.OrdinalIgnoreCase);

        IndexIncludableRoots(settingsType, [], fragmentItemTypesByRoot, knownIncludeRoots);
        IndexPresettableRoots(settingsType, [], presetObjectTypesByRoot, knownPresetRoots);

        return new SettingsSchemaSyncMetadata(
            fragmentItemTypesByRoot,
            presetObjectTypesByRoot,
            knownIncludeRoots,
            knownPresetRoots
        );
    }

    private static void IndexIncludableRoots(
        Type type,
        HashSet<Type> visitedTypes,
        Dictionary<string, Type> fragmentItemTypesByRoot,
        HashSet<string> knownIncludeRoots
    ) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var includable = property.GetCustomAttribute<IncludableAttribute>();
            if (includable != null && TryGetCollectionItemType(property.PropertyType, out var itemType)) {
                var rawRoot = includable.FragmentSchemaName ?? property.Name.ToLowerInvariant();
                var normalizedRoot = IncludableFragmentRoots.NormalizeRoot(rawRoot);
                _ = knownIncludeRoots.Add(normalizedRoot);

                if (fragmentItemTypesByRoot.TryGetValue(normalizedRoot, out var existingType) &&
                    existingType != itemType) {
                    throw new InvalidOperationException(
                        $"Includable root '{normalizedRoot}' maps to multiple fragment item types: '{existingType.Name}' and '{itemType!.Name}'."
                    );
                }

                fragmentItemTypesByRoot[normalizedRoot] = itemType!;
            }

            var nestedType = UnwrapComplexType(property.PropertyType);
            if (nestedType != null)
                IndexIncludableRoots(nestedType, visitedTypes, fragmentItemTypesByRoot, knownIncludeRoots);
        }
    }

    private static void IndexPresettableRoots(
        Type type,
        HashSet<Type> visitedTypes,
        Dictionary<string, Type> presetObjectTypesByRoot,
        HashSet<string> knownPresetRoots
    ) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var presettable = property.GetCustomAttribute<PresettableAttribute>();
            var nestedType = UnwrapComplexType(property.PropertyType);

            if (presettable != null) {
                if (nestedType == null) {
                    throw new InvalidOperationException(
                        $"[Presettable] can only be applied to complex object properties. Property '{type.Name}.{property.Name}' is not a complex object."
                    );
                }

                var normalizedRoot = IncludableFragmentRoots.NormalizeRoot(presettable.FragmentSchemaName);
                _ = knownPresetRoots.Add(normalizedRoot);

                if (presetObjectTypesByRoot.TryGetValue(normalizedRoot, out var existingType) &&
                    existingType != nestedType) {
                    throw new InvalidOperationException(
                        $"Preset root '{normalizedRoot}' maps to multiple object types: '{existingType.Name}' and '{nestedType.Name}'."
                    );
                }

                presetObjectTypesByRoot[normalizedRoot] = nestedType;
            }

            if (nestedType != null)
                IndexPresettableRoots(nestedType, visitedTypes, presetObjectTypesByRoot, knownPresetRoots);
        }
    }

    private static bool TryGetCollectionItemType(Type type, out Type? itemType) {
        itemType = null;
        if (type.IsArray) {
            itemType = type.GetElementType();
            return itemType != null;
        }

        if (!type.IsGenericType)
            return false;

        var genericType = type.GetGenericTypeDefinition();
        if (genericType != typeof(List<>) &&
            genericType != typeof(IList<>) &&
            genericType != typeof(ICollection<>) &&
            genericType != typeof(IEnumerable<>))
            return false;

        itemType = type.GetGenericArguments()[0];
        return true;
    }

    private static Type? UnwrapComplexType(Type propertyType) {
        var unwrapped = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (TryGetCollectionItemType(unwrapped, out var itemType) && itemType != null)
            unwrapped = itemType;

        if (unwrapped == typeof(string) || unwrapped.IsPrimitive || unwrapped.IsEnum)
            return null;

        return unwrapped.IsClass ? unwrapped : null;
    }
}
