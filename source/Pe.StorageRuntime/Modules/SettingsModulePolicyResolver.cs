using Pe.StorageRuntime.Json;
using System.Reflection;

namespace Pe.StorageRuntime.Modules;

public static class SettingsModulePolicyResolver {
    public static SettingsStorageModuleOptions CreateStorageOptions(Type settingsType) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));

        var includeRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var presetRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IndexDirectiveRoots(settingsType, [], includeRoots, presetRoots);

        return new SettingsStorageModuleOptions(
            includeRoots
                .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            presetRoots
                .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
                .ToArray()
        );
    }

    private static void IndexDirectiveRoots(
        Type type,
        HashSet<Type> visitedTypes,
        HashSet<string> includeRoots,
        HashSet<string> presetRoots
    ) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var includable = property.GetCustomAttribute<IncludableAttribute>();
            if (includable != null) {
                var rawRoot = includable.FragmentSchemaName ?? property.Name.ToLowerInvariant();
                _ = includeRoots.Add(IncludableFragmentRoots.NormalizeRoot(rawRoot));
            }

            var presettable = property.GetCustomAttribute<PresettableAttribute>();
            if (presettable != null)
                _ = presetRoots.Add(IncludableFragmentRoots.NormalizeRoot(presettable.FragmentSchemaName));

            var nestedType = UnwrapComplexType(property.PropertyType);
            if (nestedType != null)
                IndexDirectiveRoots(nestedType, visitedTypes, includeRoots, presetRoots);
        }
    }

    private static Type? UnwrapComplexType(Type propertyType) {
        var unwrapped = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (TryGetCollectionItemType(unwrapped, out var collectionItemType) && collectionItemType != null)
            unwrapped = collectionItemType;

        if (unwrapped == typeof(string) || unwrapped.IsPrimitive || unwrapped.IsEnum)
            return null;

        return unwrapped.IsClass ? unwrapped : null;
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
}
