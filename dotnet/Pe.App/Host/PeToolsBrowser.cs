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

    /// <summary>With a member, opens it as the Pods route's subject (<c>member</c>); without one, the app root. Path and keys are the route contract's (<see cref="PeRoutes"/>).</summary>
    public static bool TryLaunch(PodMemberAddress? member = null) {
        try {
            var baseUrl = TsHostLauncher.ResolveHostBaseUrl().TrimEnd('/');
            var target = member is null
                ? baseUrl
                : $"{baseUrl}{PeRoutes.Pods.Path}?{PeRoutes.Pods.Keys.Member}={Uri.EscapeDataString(member.SubjectField())}";
            _ = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
            return true;
        } catch {
            return false;
        }
    }
}

internal sealed record PodMemberAddress(string Pod, string Path) {
    /// <summary>
    /// The Pods subject field: one <c>name</c> SubjectRef over the tuple <c>[pod, path]</c>. The codec's
    /// authority is <c>ts/packages/agent-contracts/src/subject-ref.ts</c> (ADR 0035 rule 2), and the web
    /// refuses any spelling that is not its canonical one; this mirrors only the name kind, for this link.
    /// </summary>
    public string SubjectField() {
        var key = Newtonsoft.Json.JsonConvert.SerializeObject(new[] { this.Pod, this.Path });
        var code = "name:" + System.Text.RegularExpressions.Regex.Replace(key, "[%:~@#/]",
            m => "%" + ((int)m.Value[0]).ToString("x2"));
        return Newtonsoft.Json.JsonConvert.SerializeObject(new { kind = "ids", ids = new[] { code } });
    }
}
