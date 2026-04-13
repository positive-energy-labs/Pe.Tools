using System.Diagnostics;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Tools.SettingsEditor;

internal static class SettingsEditorBrowser {
    public static bool TryLaunch(
        string? moduleKey = null,
        string? rootKey = null,
        string? relativePath = null,
        string? sessionId = null
    ) {
        try {
            var baseUrl = GetValueOrDefault(
                SettingsEditorRuntime.FrontendBaseUrlVariable,
                SettingsEditorRuntime.DefaultFrontendBaseUrl
            );
            var routePath = SettingsEditorRuntime.NormalizeRoutePath(GetValueOrDefault(
                SettingsEditorRuntime.FrontendRouteVariable,
                SettingsEditorRuntime.DefaultFrontendRoute
            ));
            var query = new List<string>();

            if (!string.IsNullOrWhiteSpace(moduleKey))
                query.Add($"moduleKey={Uri.EscapeDataString(moduleKey)}");

            if (!string.IsNullOrWhiteSpace(rootKey))
                query.Add($"rootKey={Uri.EscapeDataString(rootKey)}");

            if (!string.IsNullOrWhiteSpace(relativePath))
                query.Add($"relativePath={Uri.EscapeDataString(relativePath)}");

            if (!string.IsNullOrWhiteSpace(sessionId))
                query.Add($"sessionId={Uri.EscapeDataString(sessionId)}");

            var targetUrl = query.Count == 0
                ? $"{baseUrl.TrimEnd('/')}{routePath}"
                : $"{baseUrl.TrimEnd('/')}{routePath}?{string.Join("&", query)}";
            _ = Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }

    private static string GetValueOrDefault(string variableName, string defaultValue) {
        var value = Environment.GetEnvironmentVariable(variableName);
        return string.IsNullOrWhiteSpace(value) ? defaultValue : value;
    }
}
