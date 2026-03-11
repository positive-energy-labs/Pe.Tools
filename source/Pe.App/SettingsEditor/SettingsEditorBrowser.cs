using System.Diagnostics;

namespace Pe.Tools.SettingsEditor;

internal static class SettingsEditorBrowser {
    private const string FrontendBaseUrlVariable = "PE_SETTINGS_EDITOR_BASE_URL";
    private const string FrontendRouteVariable = "PE_SETTINGS_EDITOR_ROUTE";
    private const string SignalRBaseUrlVariable = "PE_SETTINGS_EDITOR_SIGNALR_BASE_URL";
    private const string DefaultFrontendBaseUrl = "http://localhost:5150";
    private const string DefaultFrontendRoute = "/settings-prototype";
    private const string DefaultSignalRBaseUrl = "http://localhost:5180";

    public static bool TryLaunch(string? moduleKey = null, string? file = null) {
        try {
            var baseUrl = GetValueOrDefault(FrontendBaseUrlVariable, DefaultFrontendBaseUrl);
            var routePath = NormalizeRoutePath(GetValueOrDefault(FrontendRouteVariable, DefaultFrontendRoute));
            var signalRBaseUrl = GetValueOrDefault(SignalRBaseUrlVariable, DefaultSignalRBaseUrl);

            var query = new List<string> {
                $"signalrBaseUrl={Uri.EscapeDataString(signalRBaseUrl)}"
            };

            if (!string.IsNullOrWhiteSpace(moduleKey))
                query.Add($"moduleKey={Uri.EscapeDataString(moduleKey)}");

            if (!string.IsNullOrWhiteSpace(file))
                query.Add($"file={Uri.EscapeDataString(file)}");

            var targetUrl = $"{baseUrl.TrimEnd('/')}{routePath}?{string.Join("&", query)}";
            _ = Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }

    internal static string NormalizeRoutePath(string routePath) =>
        routePath.StartsWith("/", StringComparison.Ordinal)
            ? routePath
            : "/" + routePath;

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}
