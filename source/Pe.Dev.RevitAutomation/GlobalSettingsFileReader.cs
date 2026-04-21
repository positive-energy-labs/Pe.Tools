using Newtonsoft.Json;
using Pe.Shared.StorageRuntime;
using System.IO;

namespace Pe.Dev.RevitAutomation;

internal static class GlobalSettingsFileReader {
    public static GlobalSettings Load(string? basePathOverride = null) {
        var settingsPath = ResolveSettingsPath(basePathOverride);
        if (!File.Exists(settingsPath))
            return new GlobalSettings();

        var content = File.ReadAllText(settingsPath);
        if (string.IsNullOrWhiteSpace(content))
            return new GlobalSettings();

        try {
            return JsonConvert.DeserializeObject<GlobalSettings>(content) ?? new GlobalSettings();
        } catch (JsonException ex) {
            throw new InvalidOperationException(
                $"Failed to read APS settings from '{settingsPath}'. The file is not valid JSON.",
                ex
            );
        }
    }

    internal static string ResolveSettingsPath(string? basePathOverride = null) =>
        Path.Combine(
            basePathOverride ?? SettingsStorageLocations.GetDefaultBasePath(),
            "Global",
            "settings.json"
        );
}
