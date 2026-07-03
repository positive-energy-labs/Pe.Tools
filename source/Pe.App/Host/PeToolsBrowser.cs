using Pe.Shared.Product;
using System.Diagnostics;

namespace Pe.App.Host;

internal static class PeToolsBrowser {
    public static bool TryLaunch(
        string? moduleKey = null,
        string? rootKey = null,
        string? relativePath = null
    ) {
        try {
            var baseUrl = HostProcessIdentity.ResolveFrontendBaseUrl();
            var query = new List<string>();

            if (!string.IsNullOrWhiteSpace(moduleKey))
                query.Add($"moduleKey={Uri.EscapeDataString(moduleKey)}");

            if (!string.IsNullOrWhiteSpace(rootKey))
                query.Add($"rootKey={Uri.EscapeDataString(rootKey)}");

            if (!string.IsNullOrWhiteSpace(relativePath))
                query.Add($"relativePath={Uri.EscapeDataString(relativePath)}");

            var targetUrl = query.Count == 0
                ? baseUrl.TrimEnd('/')
                : $"{baseUrl.TrimEnd('/')}?{string.Join("&", query)}";
            _ = Process.Start(new ProcessStartInfo(targetUrl) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }
}
