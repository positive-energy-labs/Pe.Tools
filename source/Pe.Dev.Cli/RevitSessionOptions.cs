using Pe.Dev.RevitAutomation;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts;

namespace Pe.Dev.Cli;

internal sealed record RevitSessionOptions(
    bool JsonOutput,
    int? RevitYear,
    bool RequireAttachedRrd
) {
    public static RevitSessionOptions Parse(IReadOnlyList<string> args) {
        var jsonOutput = false;
        int? revitYear = null;
        var requireAttachedRrd = false;

        for (var i = 0; i < args.Count; i++) {
            switch (args[i].ToLowerInvariant()) {
            case "--json":
                jsonOutput = true;
                break;
            case "--revit-year":
                if (i + 1 >= args.Count)
                    throw new ArgumentException("Missing value for --revit-year.");

                revitYear = RevitTestCliOptions.ParseYear(args[++i]);
                break;
            case "--require-attached-rrd":
                requireAttachedRrd = true;
                break;
            default:
                throw new ArgumentException($"Unknown argument '{args[i]}' for session.");
            }
        }

        if (requireAttachedRrd && !revitYear.HasValue)
            throw new ArgumentException("`revit session --require-attached-rrd` also requires --revit-year <year>.");

        return new RevitSessionOptions(jsonOutput, revitYear, requireAttachedRrd);
    }
}

internal sealed record RevitSessionReport(
    HostProbeData? HostProbe,
    HostSessionSummaryData? HostSessionSummary,
    IReadOnlyList<RevitProcessSessionIdentity> ProcessSessions,
    RevitProcessSessionIdentity? SelectedProcessSession
) {
    public bool HostReachable => this.HostProbe != null;
    public bool HasAnySessions => (this.HostSessionSummary?.BridgeIsConnected ?? false) || this.ProcessSessions.Count != 0;
}

internal static class RevitSessionHostClient {
    public static HostProbeData? TryGetProbe() =>
        HostReachability.TryGetProbe(
            hostBaseUrl: null,
            out var probe,
            out _,
            HostRuntimeDefaults.DefaultHostProbeTimeoutMs
        )
            ? probe
            : null;

    public static HostSessionSummaryData? TryGetSessionSummary() =>
        HostReachability.TryGetSessionSummary(
            hostBaseUrl: null,
            out var sessionSummary,
            out _,
            HostRuntimeDefaults.DefaultHostProbeTimeoutMs
        )
            ? sessionSummary
            : null;

    public static string GetHostBaseUrl() => Pe.Shared.Product.HostProcessIdentity.ResolveHostBaseUrl();
}
