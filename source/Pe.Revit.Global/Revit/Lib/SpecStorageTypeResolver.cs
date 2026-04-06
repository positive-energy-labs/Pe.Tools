namespace Pe.Global.Revit.Lib;

/// <summary>
///     Resolves a SpecTypeId (ForgeTypeId) to its corresponding StorageType.
///     This is useful when you need to determine how parameter values should be
///     stored/retrieved based on their data type specification.
/// </summary>
public static class SpecStorageTypeResolver {
    private static Dictionary<ForgeTypeId, StorageType>? _nonMeasurableCache;
    private static readonly object _lock = new();

    /// <summary>
    ///     Gets the StorageType for a given SpecTypeId (ForgeTypeId).
    /// </summary>
    /// <param name="specTypeId">The spec type identifier from Definition.GetDataType() or similar.</param>
    /// <returns>
    ///     The corresponding StorageType:
    ///     - Double for measurable specs (Length, Area, etc.)
    ///     - String for text specs
    ///     - Integer for int and boolean specs
    ///     - ElementId for reference specs and category identifiers (Family Type params)
    ///     - None if the spec is empty or unrecognized
    /// </returns>
    public static StorageType GetStorageType(ForgeTypeId specTypeId) {
        if (specTypeId == null || specTypeId.Empty())
            return StorageType.None;

        // Fast path: measurable specs (most common case)
        if (UnitUtils.IsMeasurableSpec(specTypeId))
            return StorageType.Double;

        // Fast path: category identifiers (Family Type parameters)
        if (Category.IsBuiltInCategory(specTypeId))
            return StorageType.ElementId;

        // Slow path: non-measurable specs - use lazy-initialized cache
        EnsureCacheBuilt();
        // _nonMeasurableCache is guaranteed non-null after EnsureCacheBuilt()
        return _nonMeasurableCache!.TryGetValue(specTypeId, out var storageType)
            ? storageType
            : StorageType.None;
    }

    private static void EnsureCacheBuilt() {
        if (_nonMeasurableCache != null) return;

        lock (_lock) {
            if (_nonMeasurableCache != null) return;
            _nonMeasurableCache = BuildNonMeasurableCache();
        }
    }

    private static Dictionary<ForgeTypeId, StorageType> BuildNonMeasurableCache() {
        var cache = new Dictionary<ForgeTypeId, StorageType>();

        // Map nested class types to their storage types
        var nestedClassMappings = new (Type NestedClass, StorageType StorageType)[] {
            (typeof(SpecTypeId.String), StorageType.String), (typeof(SpecTypeId.Int), StorageType.Integer),
            (typeof(SpecTypeId.Boolean), StorageType.Integer), // Booleans stored as 0/1
            (typeof(SpecTypeId.Reference), StorageType.ElementId)
        };

        foreach (var (nestedClass, storageType) in nestedClassMappings) {
            var properties = nestedClass.GetProperties(BindingFlags.Public | BindingFlags.Static);

            foreach (var prop in properties) {
                if (prop.PropertyType != typeof(ForgeTypeId)) continue;

                var forgeTypeId = prop.GetValue(null) as ForgeTypeId;
                if (forgeTypeId != null && !forgeTypeId.Empty()) cache[forgeTypeId] = storageType;
            }
        }

        return cache;
    }
}