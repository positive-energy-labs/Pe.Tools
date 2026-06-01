using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Pe.Shared.StorageRuntime;
using System.Diagnostics;

namespace Pe.Host.Services;

internal sealed class HostSingletonLease : IDisposable {
    private readonly Mutex _mutex;
    private readonly EventWaitHandle _takeoverEvent;
    private bool _disposed;

    public HostSingletonLease(Mutex mutex, EventWaitHandle takeoverEvent) {
        this._mutex = mutex;
        this._takeoverEvent = takeoverEvent;
    }

    public Task StopWhenTakeoverRequestedAsync(IHostApplicationLifetime applicationLifetime) => Task.Run(() => {
        this._takeoverEvent.WaitOne();
        applicationLifetime.StopApplication();
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

            if (TryTerminateUnresponsiveHostProcesses(options, logFile) && TryWaitForMutex(mutex, GetForcedProcessExitTimeoutMs())) {
                LogWarning(logFile, "Host singleton mutex acquired after terminating an unresponsive Pe.Host process.");
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

    private static bool TryTerminateUnresponsiveHostProcesses(BridgeHostOptions options, ManagedLogFile logFile) {
        if (HostReachability.TryGetCompatibleProbe(options.HostBaseUrl, out _, out _, GetHostProbeTimeoutMs()))
            return false;

        var currentProcessId = Environment.ProcessId;
        var terminatedAny = false;
        foreach (var process in Process.GetProcessesByName(Path.GetFileNameWithoutExtension(HostProcessIdentity.ExecutableName))) {
            using (process) {
                if (process.Id == currentProcessId)
                    continue;

                string? path = null;
                try {
                    path = process.MainModule?.FileName;
                } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) {
                    LogWarning(logFile, $"Could not inspect Pe.Host process {process.Id} before forced takeover: {ex.Message}");
                }

                try {
                    var pathForLog = path ?? "<unknown>";
                    LogWarning(logFile, $"Terminating unresponsive Pe.Host process {process.Id} for forced singleton takeover. Path={pathForLog}");
                    process.Kill(entireProcessTree: true);
                    terminatedAny = true;
                } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) {
                    LogError(logFile, $"Failed to terminate unresponsive Pe.Host process {process.Id}.", ex);
                }
            }
        }

        return terminatedAny;
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
        logFile.AppendDemystifiedEntry("INF", LogSource, message);

    private static void LogWarning(ManagedLogFile logFile, string message) =>
        logFile.AppendDemystifiedEntry("WRN", LogSource, message);

    private static void LogError(ManagedLogFile logFile, string message, Exception? exception = null) =>
        logFile.AppendDemystifiedEntry("ERR", LogSource, message, exception: exception);

    private static int GetProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostStartupTimeoutMs;
    private static int GetForcedProcessExitTimeoutMs() => 5_000;
    private static int GetHostProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostProbeTimeoutMs;
}
