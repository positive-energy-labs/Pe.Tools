using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Shared.HostContracts;

public static class HostReachability {
    public static bool TryGetProbe(
        string? hostBaseUrl,
        out HostProbeData? probe,
        out string? errorMessage,
        int timeoutMs = HostRuntimeDefaults.DefaultHostProbeTimeoutMs
    ) {
        try {
            using var client = new PeHostClient(
                new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) },
                hostBaseUrl
            );
            probe = client.Host.GetProbeAsync().GetAwaiter().GetResult();
            errorMessage = null;
            return true;
        } catch (Exception ex) {
            probe = null;
            errorMessage = ex.Message;
            return false;
        }
    }

    public static bool TryGetCompatibleProbe(
        string? hostBaseUrl,
        out HostProbeData? probe,
        out string? errorMessage,
        int timeoutMs = HostRuntimeDefaults.DefaultHostProbeTimeoutMs
    ) {
        if (!TryGetProbe(hostBaseUrl, out probe, out errorMessage, timeoutMs))
            return false;

        errorMessage = HostProbeCompatibility.DescribeIncompatibility(probe);
        return errorMessage == null;
    }

    public static bool TryGetSessionSummary(
        string? hostBaseUrl,
        out HostSessionSummaryData? sessionSummary,
        out string? errorMessage,
        int timeoutMs = HostRuntimeDefaults.DefaultHostProbeTimeoutMs
    ) {
        try {
            using var client = new PeHostClient(
                new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) },
                hostBaseUrl
            );
            sessionSummary = client.Host.GetSessionSummaryAsync().GetAwaiter().GetResult();
            errorMessage = null;
            return true;
        } catch (Exception ex) {
            sessionSummary = null;
            errorMessage = ex.Message;
            return false;
        }
    }
}
