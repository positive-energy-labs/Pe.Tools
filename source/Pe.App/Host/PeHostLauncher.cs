using Pe.Shared.HostContracts;
using Pe.Shared.Product;
using Serilog;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Host;

internal sealed record PeHostLaunchResult(
    bool Success,
    bool AlreadyRunning,
    bool StartedProcess,
    string Message
);

internal static class PeHostLauncher {
    public static PeHostLaunchResult EnsureRunning() {
        try {
            if (HostReachability.TryGetCompatibleProbe(
                    GetHostBaseUrl(),
                    out _,
                    out _,
                    HostRuntimeDefaults.DefaultHostProbeTimeoutMs
                ))
                return new PeHostLaunchResult(true, true, false,
                    "Host is already running.");

            if (!IsAutoStartEnabled())
                return new PeHostLaunchResult(false, false, false, GetAutoStartDisabledMessage());

            if (!TryResolveLaunchCommand(out var launchCommand, out var launchArguments, out var workingDirectory)) {
                return new PeHostLaunchResult(
                    false,
                    false,
                    false,
                    $"Could not locate Pe.Host. Check {HostProcessIdentity.HostExecutablePathVariable} or install {ProductIdentity.ProductName}."
                );
            }

            var startInfo = new ProcessStartInfo(launchCommand) {
                Arguments = launchArguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            _ = Process.Start(startInfo);

            var startupTimeout = TimeSpan.FromMilliseconds(GetStartupTimeoutMs());
            var deadlineUtc = DateTime.UtcNow + startupTimeout;
            while (DateTime.UtcNow < deadlineUtc) {
                Thread.Sleep(250);
                if (HostReachability.TryGetCompatibleProbe(
                        GetHostBaseUrl(),
                        out _,
                        out _,
                        GetHostProbeTimeoutMs()
                    )) {
                    return new PeHostLaunchResult(
                        true,
                        false,
                        true,
                        "Started the host."
                    );
                }
            }

            return new PeHostLaunchResult(
                false,
                false,
                true,
                $"Started Pe.Host but it did not become compatible within {startupTimeout.TotalSeconds:0.#} seconds."
            );
        } catch (Exception ex) {
            return new PeHostLaunchResult(false, false, false, ex.Message);
        }
    }

    private static bool TryResolveLaunchCommand(
        out string launchCommand,
        out string launchArguments,
        out string workingDirectory
    ) {
        var runtimeResolution = ProductRuntimeAuthority.ResolveForExecutingPeAppAssembly(
            typeof(PeHostLauncher).Assembly.Location
        );
        foreach (var candidate in GetCandidateExecutablePaths(runtimeResolution)) {
            if (!File.Exists(candidate))
                continue;

            workingDirectory = Path.GetDirectoryName(candidate)
                               ?? throw new InvalidOperationException("Resolved host path had no directory.");
            Log.Information(
                "Resolved Pe.Host launch candidate '{Candidate}' via runtime lane {RuntimeLane} ({Source}).",
                candidate,
                runtimeResolution.RuntimeLane,
                runtimeResolution.Source
            );

            if (candidate.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)) {
                launchCommand = "dotnet";
                launchArguments = $"\"{candidate}\"";
                return true;
            }

            launchCommand = candidate;
            launchArguments = string.Empty;
            return true;
        }

        launchCommand = string.Empty;
        launchArguments = string.Empty;
        workingDirectory = string.Empty;
        return false;
    }

    private static IEnumerable<string> GetCandidateExecutablePaths(ProductRuntimeResolution runtimeResolution) {
        var configuredExecutablePath = Environment.GetEnvironmentVariable(HostProcessIdentity.HostExecutablePathVariable);
        if (!string.IsNullOrWhiteSpace(configuredExecutablePath)) {
            yield return configuredExecutablePath;
            if (configuredExecutablePath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) {
                var configuredDllPath = Path.ChangeExtension(configuredExecutablePath, ".dll");
                if (!string.IsNullOrWhiteSpace(configuredDllPath))
                    yield return configuredDllPath;
            }
        }

        yield return runtimeResolution.HostExecutablePath;
        yield return runtimeResolution.HostDllPath;
    }

    internal static string GetHostBaseUrl() => HostProcessIdentity.ResolveHostBaseUrl();
    private static int GetStartupTimeoutMs() => HostRuntimeDefaults.DefaultHostStartupTimeoutMs;
    private static int GetHostProbeTimeoutMs() => HostRuntimeDefaults.DefaultHostProbeTimeoutMs;
    private static bool IsAutoStartEnabled() => HostRuntimeDefaults.ResolveHostAutoStartEnabled(Debugger.IsAttached);

    private static string GetAutoStartDisabledMessage() {
        var configuredValue = Environment.GetEnvironmentVariable(HostProcessIdentity.HostAutoStartEnabledVariable);
        if (bool.TryParse(configuredValue, out var isEnabled) && !isEnabled) {
            return
                $"Host is not running. Automatic startup is disabled by {HostProcessIdentity.HostAutoStartEnabledVariable}. Start Pe.Host manually or set it to true.";
        }

        return
            $"Host is not running. Automatic startup is disabled while debugging. Start Pe.Host manually or set {HostProcessIdentity.HostAutoStartEnabledVariable}=true to re-enable it.";
    }
}
