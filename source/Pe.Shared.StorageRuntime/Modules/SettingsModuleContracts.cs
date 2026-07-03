namespace Pe.Shared.StorageRuntime.Modules;

public sealed record SettingsStorageModuleOptions(
    IReadOnlyCollection<string> IncludeRoots,
    IReadOnlyCollection<string> PresetRoots
) {
    public static SettingsStorageModuleOptions Empty { get; } = new([], []);
}
