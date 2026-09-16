namespace Pe.Shared.StorageRuntime.Json;

public static class SettingsDirectiveRootCatalog {
    public static IReadOnlyList<string> IncludeRoots { get; } = Enum
        .GetValues(typeof(IncludableFragmentRoot))
        .Cast<IncludableFragmentRoot>()
        .Select(IncludableFragmentRoots.ToNormalizedRoot)
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();

    public static IReadOnlyList<string> PresetRoots { get; } = new[] {
            IncludableFragmentRoots.NormalizeRoot("filter-aps-params"),
            IncludableFragmentRoots.NormalizeRoot("filter-families")
        }
        .OrderBy(root => root, StringComparer.OrdinalIgnoreCase)
        .ToArray();
}
