using System.Diagnostics;

namespace Pe.Tools.SettingsEditor;

internal static class SettingsEditorBrowser {
    private const string FrontendBaseUrlVariable = "PE_SETTINGS_EDITOR_BASE_URL";
    private const string FrontendRouteVariable = "PE_SETTINGS_EDITOR_ROUTE";
    private const string DefaultFrontendBaseUrl = "http://localhost:5150";
    private const string DefaultFrontendRoute = "/settings-prototype";

    public static bool TryLaunch(
        string? moduleKey = null,
        string? rootKey = null,
        string? relativePath = null
    ) {
        try {
            var baseUrl = GetValueOrDefault(FrontendBaseUrlVariable, DefaultFrontendBaseUrl);
            var routePath = NormalizeRoutePath(GetValueOrDefault(FrontendRouteVariable, DefaultFrontendRoute));
            var query = new List<string>();

            if (!string.IsNullOrWhiteSpace(moduleKey))
                query.Add($"moduleKey={Uri.EscapeDataString(moduleKey)}");

            if (!string.IsNullOrWhiteSpace(rootKey))
                query.Add($"rootKey={Uri.EscapeDataString(rootKey)}");

            if (!string.IsNullOrWhiteSpace(relativePath))
                query.Add($"relativePath={Uri.EscapeDataString(relativePath)}");

            var targetUrl = query.Count == 0
                ? $"{baseUrl.TrimEnd('/')}{routePath}"
                : $"{baseUrl.TrimEnd('/')}{routePath}?{string.Join("&", query)}";
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
