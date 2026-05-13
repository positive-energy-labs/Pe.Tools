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
            var process = Process.Start(startInfo);

            var startupTimeout = TimeSpan.FromMilliseconds(GetStartupTimeoutMs());
            var deadlineUtc = DateTime.UtcNow + startupTimeout;
            string? lastProbeError = null;
            while (DateTime.UtcNow < deadlineUtc) {
                Thread.Sleep(250);
                if (HostReachability.TryGetCompatibleProbe(
                        GetHostBaseUrl(),
                        out _,
                        out lastProbeError,
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
                FormatStartupTimeoutMessage(
                    startupTimeout,
                    launchCommand,
                    launchArguments,
                    workingDirectory,
                    process?.Id,
                    lastProbeError
                )
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

    private static string FormatStartupTimeoutMessage(
        TimeSpan startupTimeout,
        string launchCommand,
        string launchArguments,
        string workingDirectory,
        int? processId,
        string? lastProbeError
    ) {
        var logPath = ProductRuntimeLayout.ForCurrentUser().Logs.HostLogPath;
        var processText = processId is int id ? id.ToString() : "unknown";
        var commandText = string.IsNullOrWhiteSpace(launchArguments)
            ? launchCommand
            : $"{launchCommand} {launchArguments}";
        return string.Join(
            Environment.NewLine,
            $"Started Pe.Host but it did not become ready at {GetHostBaseUrl()} within {startupTimeout.TotalSeconds:0.#} seconds.",
            $"Command: {commandText}",
            $"Working directory: {workingDirectory}",
            $"Process id: {processText}",
            $"Last probe: {lastProbeError ?? "no probe response"}",
            $"Host log: {logPath}"
        );
    }
}
