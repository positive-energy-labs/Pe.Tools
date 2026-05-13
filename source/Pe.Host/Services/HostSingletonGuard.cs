using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;

namespace Pe.Host.Services;

internal sealed class HostSingletonLease : IDisposable {
    private readonly Mutex _mutex;
    private readonly EventWaitHandle _takeoverEvent;
    private bool _disposed;

    public HostSingletonLease(Mutex mutex, EventWaitHandle takeoverEvent) {
        this._mutex = mutex;
        this._takeoverEvent = takeoverEvent;
    }

    public Task StopWhenTakeoverRequestedAsync(WebApplication app) => Task.Run(async () => {
        this._takeoverEvent.WaitOne();
        await app.StopAsync();
    });

    public void Dispose() {
        if (this._disposed)
            return;

        this._disposed = true;
        this._takeoverEvent.Dispose();
        this._mutex.ReleaseMutex();
        this._mutex.Dispose();
    }
}

internal static class HostSingletonGuard {
    private const string LogSource = "Pe.Host.Services.HostSingletonGuard";

    public static HostSingletonLease AcquireOrTakeOver(BridgeHostOptions options, ManagedLogFile logFile) {
        LogInfo(logFile, $"Acquiring host singleton mutex '{HostProcessIdentity.HostSingletonMutexName}'.");
        var mutex = new Mutex(true, HostProcessIdentity.HostSingletonMutexName, out var createdNew);
        if (createdNew) {
            LogInfo(logFile, "Host singleton mutex acquired.");
            return CreateLease(mutex);
        }

        LogWarning(logFile, "Host singleton mutex is already held. Requesting takeover from existing host process.");
        mutex.Dispose();
        RequestTakeover(options, logFile);
        return WaitForLeaseAfterTakeover(options, logFile);
    }

    private static HostSingletonLease CreateLease(Mutex mutex) =>
        new(mutex, new EventWaitHandle(false, EventResetMode.AutoReset, HostProcessIdentity.HostTakeoverEventName));

    private static void RequestTakeover(BridgeHostOptions options, ManagedLogFile logFile) {
        if (!EventWaitHandle.TryOpenExisting(HostProcessIdentity.HostTakeoverEventName, out var takeoverEvent)) {
            var message = FormatTakeoverFailureMessage(options, "No active host takeover channel was found.");
            LogError(logFile, message);
            throw new InvalidOperationException(message);
        }

        using (takeoverEvent)
            takeoverEvent.Set();
        LogInfo(logFile, $"Signaled host takeover event '{HostProcessIdentity.HostTakeoverEventName}'.");
    }

    private static HostSingletonLease WaitForLeaseAfterTakeover(BridgeHostOptions options, ManagedLogFile logFile) {
        var mutex = new Mutex(false, HostProcessIdentity.HostSingletonMutexName);
        try {
            if (TryWaitForMutex(mutex, GetProbeTimeoutMs())) {
                LogInfo(logFile, "Host singleton mutex acquired after takeover request.");
                return CreateLease(mutex);
            }
        } catch (Exception ex) {
            LogError(logFile, "Host singleton mutex wait failed after takeover request.", ex);
            mutex.Dispose();
            throw;
        }

        mutex.Dispose();
        var message = FormatTakeoverFailureMessage(options, "The existing host did not release the singleton mutex.");
        LogError(logFile, message);
        throw new InvalidOperationException(message);
    }

    private static bool TryWaitForMutex(Mutex mutex, int timeoutMs) {
        try {
            return mutex.WaitOne(timeoutMs);
        } catch (AbandonedMutexException) {
            return true;
        }
    }

    private static string FormatTakeoverFailureMessage(BridgeHostOptions options, string reason) {
        var compatibilityStatus = HostReachability.TryGetCompatibleProbe(
            options.HostBaseUrl,
            out _,
            out var probeError,
            GetHostProbeTimeoutMs()
        )
            ? "A compatible host responded, but takeover failed."
            : probeError ?? "No compatible host responded.";

        return string.Join(
            Environment.NewLine,
            $"Another process already holds mutex '{HostProcessIdentity.HostSingletonMutexName}'.",
            $"Takeover failed: {reason}",
            $"Host URL: {options.HostBaseUrl}",
            $"Probe: {compatibilityStatus}",
            $"Host log: {ProductRuntimeLayout.ForCurrentUser().Logs.HostLogPath}"
        );
    }

    private static void LogInfo(ManagedLogFile logFile, string message) =>
        logFile.AppendStructuredEntry("INF", LogSource, message);

    private static void LogWarning(ManagedLogFile logFile, string message) =>
        logFile.AppendStructuredEntry("WRN", LogSource, message);

    private static void LogError(ManagedLogFile logFile, string message, Exception? exception = null) =>
        logFile.AppendStructuredEntry("ERR", LogSource, message, exception: exception);

    private static int GetProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostStartupTimeoutMs;
    private static int GetHostProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostProbeTimeoutMs;
}
