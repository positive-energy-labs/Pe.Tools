using System.Diagnostics;

namespace Pe.App.Host;

/// <summary>Opens the Pe Tools web app, served by the TS host at its bound address, in the default browser.</summary>
internal static class PeToolsBrowser {
    /// <summary>Opens a product route without inferring a document target or a Work identity.</summary>
    public static bool TryLaunchRoute(string route) {
        try {
            if (!route.StartsWith("/", StringComparison.Ordinal)) return false;
            var baseUrl = TsHostLauncher.ResolveHostBaseUrl().TrimEnd('/');
            _ = Process.Start(new ProcessStartInfo($"{baseUrl}{route}") { UseShellExecute = true });
            return true;
        } catch (Exception ex) {
            Serilog.Log.Warning(ex, "Could not open Pe.Tools product route {Route}", route);
            return false;
        }
    }

    /// <summary>With a member, opens it on `/pods?pod=&amp;path=`; without one, the app root.</summary>
    public static bool TryLaunch(PodMemberAddress? member = null) {
        try {
            var baseUrl = TsHostLauncher.ResolveHostBaseUrl().TrimEnd('/');
            var target = member is null
                ? baseUrl
                : $"{baseUrl}/pods?pod={Uri.EscapeDataString(member.Pod)}&path={Uri.EscapeDataString(member.Path)}";
            _ = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }
}

internal sealed record PodMemberAddress(string Pod, string Path);
