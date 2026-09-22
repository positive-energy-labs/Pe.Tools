using Newtonsoft.Json;
using Pe.Shared.Product;

namespace Pe.Shared.StorageRuntime;

public sealed class ApsCredentialSource {
    public string GetConfiguredWebClientId() => this.ReadCredentials().WebClientId;

    public ApsCredentials ReadCredentials(string? basePathOverride = null) {
        var settings = this.ReadCredentialsFile(basePathOverride);
        return new ApsCredentials(
            this.RequireConfigured(settings.ApsWebClientId1, "APS web client id", nameof(ApsCredentialSettings.ApsWebClientId1), basePathOverride),
            this.RequireConfigured(settings.ApsWebClientSecret1, "APS web client secret", nameof(ApsCredentialSettings.ApsWebClientSecret1), basePathOverride)
        );
    }

    public string ResolveCredentialsPath(string? basePathOverride = null) =>
        string.IsNullOrWhiteSpace(basePathOverride)
            ? ProductRuntimeLayout.ForCurrentUser().State.ApsCredentialsPath
            : Path.Combine(Path.GetFullPath(basePathOverride), "credentials.json");

    public ApsCredentialSettings ReadCredentialsFile(string? basePathOverride = null) {
        var settingsPath = this.ResolveCredentialsPath(basePathOverride);
        if (!File.Exists(settingsPath))
            return new ApsCredentialSettings();

        var content = File.ReadAllText(settingsPath);
        if (string.IsNullOrWhiteSpace(content))
            return new ApsCredentialSettings();

        try {
            return JsonConvert.DeserializeObject<ApsCredentialSettings>(content) ?? new ApsCredentialSettings();
        } catch (JsonException ex) {
            throw new InvalidOperationException(
                $"Failed to read APS credentials from '{settingsPath}'. The file is not valid JSON.",
                ex
            );
        }
    }

    private string RequireConfigured(string value, string label, string propertyName, string? basePathOverride = null) {
        if (!string.IsNullOrWhiteSpace(value))
            return value;

        throw new InvalidOperationException(
            $"{label} is not configured. Populate '{propertyName}' in '{this.ResolveCredentialsPath(basePathOverride)}'."
        );
    }
}
