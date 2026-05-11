using Pe.Shared.HostContracts;
using Pe.Shared.Product;

namespace Pe.Host.Services;

internal static class HostSingletonGuard {
    public static IDisposable? TryAcquireOrExit(BridgeHostOptions options) {
        var mutex = new Mutex(true, HostProcessIdentity.HostSingletonMutexName, out var createdNew);
        if (createdNew)
            return mutex;

        mutex.Dispose();

        if (WaitForCompatibleHost(options)) {
            Console.WriteLine(
                "A compatible Pe.Host instance is already running at {0}. Exiting duplicate instance.",
                options.HostBaseUrl
            );
            return null;
        }

        throw new InvalidOperationException(
            $"Another process already holds mutex '{HostProcessIdentity.HostSingletonMutexName}', but no compatible {ProductIdentity.ProductName} host responded at '{options.HostBaseUrl}'."
        );
    }

    private static bool WaitForCompatibleHost(BridgeHostOptions options) {
        var deadlineUtc = DateTime.UtcNow.AddMilliseconds(GetProbeTimeoutMs());
        while (DateTime.UtcNow < deadlineUtc) {
            if (HostReachability.TryGetCompatibleProbe(
                    options.HostBaseUrl,
                    out _,
                    out _,
                    GetHostProbeTimeoutMs()
                ))
                return true;

            Thread.Sleep(250);
        }

        return false;
    }

    private static int GetProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostStartupTimeoutMs;
    private static int GetHostProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostProbeTimeoutMs;
}
