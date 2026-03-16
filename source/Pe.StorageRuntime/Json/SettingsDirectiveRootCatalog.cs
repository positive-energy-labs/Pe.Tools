namespace Pe.StorageRuntime.Json;

public static class PresetFragmentRoots {
    public static string FilterApsParams => IncludableFragmentRoots.NormalizeRoot("filter-aps-params");

    public static string FilterFamilies => IncludableFragmentRoots.NormalizeRoot("filter-families");

    public static IReadOnlyList<string> All { get; } = [
        FilterApsParams,
        FilterFamilies
    ];
}

public static class SettingsDirectiveRootCatalog {
    public static IReadOnlyList<string> GlobalIncludeRoots { get; } = Enum
        .GetValues(typeof(IncludableFragmentRoot))
        .Cast<IncludableFragmentRoot>()
        .Select(IncludableFragmentRoots.ToNormalizedRoot)
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    public static IReadOnlyList<string> GlobalPresetRoots { get; } = PresetFragmentRoots.All
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();
}