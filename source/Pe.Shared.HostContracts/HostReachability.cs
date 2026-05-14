using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;

namespace Pe.Shared.HostContracts;

public static class HostReachability {
    public static bool TryGetProbe(
        string? hostBaseUrl,
        out HostProbeData? probe,
        out string? errorMessage,
        int timeoutMs = HostRuntimeDefaults.DefaultHostProbeTimeoutMs
    ) => TryGet(hostBaseUrl, out probe, out errorMessage, timeoutMs, client =>
        client.Host.GetProbeAsync().GetAwaiter().GetResult()
    );

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
    ) => TryGet(hostBaseUrl, out sessionSummary, out errorMessage, timeoutMs, client =>
        client.Host.GetSessionSummaryAsync().GetAwaiter().GetResult()
    );

    private static bool TryGet<T>(
        string? hostBaseUrl,
        out T? result,
        out string? errorMessage,
        int timeoutMs,
        Func<PeHostClient, T> read
    )
        where T : class {
        try {
            using var client = CreateClient(hostBaseUrl, timeoutMs);
            result = read(client);
            errorMessage = null;
            return true;
        } catch (Exception ex) {
            result = null;
            errorMessage = ex.Message;
            return false;
        }
    }

    private static PeHostClient CreateClient(string? hostBaseUrl, int timeoutMs) =>
        new(
            new HttpClient { Timeout = TimeSpan.FromMilliseconds(timeoutMs) },
            hostBaseUrl
        );
}
