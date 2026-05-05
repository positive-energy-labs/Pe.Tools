using Newtonsoft.Json;
using Pe.Shared.SettingsLayout;

namespace Pe.Aps.Auth;

public sealed class ApsCredentialSource {
    public global::Pe.Aps.Aps CreateAps() => new(this.CreateWebAuthTokenProvider());

    public string GetConfiguredWebClientId() => this.CreateWebAuthTokenProvider().GetClientId();

    public global::Pe.Aps.Aps.IOAuthTokenProvider CreateWebAuthTokenProvider() {
        var settings = this.ReadSettings();
        return new StoredApsWebAuthTokenProvider(
            this.RequireConfigured(settings.ApsWebClientId1, "APS web client id", nameof(GlobalSettings.ApsWebClientId1)),
            this.RequireConfigured(
                settings.ApsWebClientSecret1,
                "APS web client secret",
                nameof(GlobalSettings.ApsWebClientSecret1)
            )
        );
    }

    public string ResolveSettingsPath(string? basePathOverride = null) =>
        GlobalStorageLocations.ResolveSettingsPath(basePathOverride ?? SettingsStorageLocations.GetDefaultBasePath());

    public GlobalSettings ReadSettings(string? basePathOverride = null) {
        var settingsPath = this.ResolveSettingsPath(basePathOverride);
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

    private string RequireConfigured(string value, string label, string propertyName) {
        if (!string.IsNullOrWhiteSpace(value))
            return value;

        throw new InvalidOperationException(
            $"{label} is not configured. Populate '{propertyName}' in '{this.ResolveSettingsPath()}'."
        );
    }

    private sealed class StoredApsWebAuthTokenProvider(string clientId, string clientSecret) : global::Pe.Aps.Aps.IOAuthTokenProvider {
        public string GetClientId() => clientId;
        public string GetClientSecret() => clientSecret;
    }
}
