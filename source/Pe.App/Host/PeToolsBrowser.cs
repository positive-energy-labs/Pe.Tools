using System.Diagnostics;

namespace Pe.App.Host;

/// <summary>
///     Opens the Pe Tools web app in the user's default browser. Post-squash the web SPA is served by
///     the TS host itself (same origin as the bridge / <c>/call</c>), so the base URL is the host's
///     actual bound address from the runtime service file — never the old out-of-process frontend port.
///     Optional deep-link params (module/root/relative path) are appended as a query string.
/// </summary>
internal static class PeToolsBrowser {
    public static bool TryLaunch(
        string? moduleKey = null,
        string? rootKey = null,
        string? relativePath = null
    ) {
        try {
            var baseUrl = TsHostLauncher.ResolveHostBaseUrl().TrimEnd('/');
            var query = new List<string>();

            if (!string.IsNullOrWhiteSpace(moduleKey))
                query.Add($"moduleKey={Uri.EscapeDataString(moduleKey)}");

            if (!string.IsNullOrWhiteSpace(rootKey))
                query.Add($"rootKey={Uri.EscapeDataString(rootKey)}");

            if (!string.IsNullOrWhiteSpace(relativePath))
                query.Add($"relativePath={Uri.EscapeDataString(relativePath)}");

            var targetUrl = query.Count == 0
                ? baseUrl
                : $"{baseUrl}?{string.Join("&", query)}";
            _ = Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }
}
