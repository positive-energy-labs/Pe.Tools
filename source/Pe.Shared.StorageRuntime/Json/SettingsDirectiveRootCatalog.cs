namespace Pe.Shared.StorageRuntime.Json;

public static class SettingsDirectiveRootCatalog {
    public static IReadOnlyList<string> GlobalIncludeRoots { get; } = Enum
        .GetValues(typeof(IncludableFragmentRoot))
        .Cast<IncludableFragmentRoot>()
        .Select(IncludableFragmentRoots.ToNormalizedRoot)
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    public static IReadOnlyList<string> GlobalPresetRoots { get; } = new[] {
            IncludableFragmentRoots.NormalizeRoot("filter-aps-params"),
            IncludableFragmentRoots.NormalizeRoot("filter-families")
        }
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();
}
