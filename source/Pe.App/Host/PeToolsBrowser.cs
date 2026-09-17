using System.Diagnostics;

namespace Pe.App.Host;

/// <summary>
///     Opens the Pe Tools web app in the user's default browser. Post-squash the web SPA is served by
///     the TS host itself (same origin as the bridge / <c>/call</c>), so the base URL is the host's
///     actual bound address from the runtime service file — never the old out-of-process frontend port.
/// </summary>
internal static class PeToolsBrowser {
    public static bool TryLaunch() {
        try {
            _ = Process.Start(new ProcessStartInfo(TsHostLauncher.ResolveHostBaseUrl().TrimEnd('/')) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }
}
