using Pe.Shared.Aps;
using Pe.Shared.SettingsLayout;

namespace Pe.Dev.RevitAutomation;

internal sealed class StoredApsWebAuthTokenProvider : Aps.IOAuthTokenProvider {
    public string GetClientId() => RequireConfigured(
        ReadSettings().ApsWebClientId1,
        "APS web client id",
        "ApsWebClientId1"
    );

    public string GetClientSecret() => RequireConfigured(
        ReadSettings().ApsWebClientSecret1,
        "APS web client secret",
        "ApsWebClientSecret1"
    );

    private static string RequireConfigured(string value, string label, string propertyName) {
        if (!string.IsNullOrWhiteSpace(value))
            return value;

        var settingsPath = GlobalSettingsFileReader.ResolveSettingsPath();
        throw new InvalidOperationException(
            $"{label} is not configured. Populate '{propertyName}' in '{settingsPath}'."
        );
    }

    private static GlobalSettings ReadSettings() => GlobalSettingsFileReader.Load();
}