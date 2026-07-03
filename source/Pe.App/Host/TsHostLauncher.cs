using Pe.Shared.Product;
using Pe.Shared.HostContracts;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text.Json;

namespace Pe.App.Host;

internal static class TsHostLauncher {
    private const string HostLaneVariable = "PE_TOOLS_HOST_LANE";
    private static readonly HttpClient HttpClient = new() {
        Timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostProbeTimeoutMs)
    };

    public static TsHostLaunchResult EnsureRunning() {
        try {
            var runtimeResolution = ProductRuntimeAuthority.ResolveForExecutingPeAppAssembly(
                typeof(TsHostLauncher).Assembly.Location
            );
            var runningHost = TryGetRunningHostStatus();
            if (runningHost != null) {
                if (MatchesRuntime(runningHost, runtimeResolution))
                    return new TsHostLaunchResult(
                        true,
                        true,
                        false,
                        $"Matching TS host is already listening: {Describe(runningHost)}"
                    );

                if (!CanStartOver(runningHost, runtimeResolution))
                    return new TsHostLaunchResult(
                        false,
                        false,
                        false,
                        $"Host port is occupied by {Describe(runningHost)}, but Pe.App resolved {Describe(runtimeResolution)}. Stop the other host or switch lanes."
                    );
            }

            var hostExecutablePath = runtimeResolution.HostExecutablePath;
            if (!File.Exists(hostExecutablePath))
                return new TsHostLaunchResult(
                    false,
                    false,
                    false,
                    $"{runtimeResolution.RuntimeLane} TS host was not found: {hostExecutablePath}"
                );

            return StartAndWait(
                CreateStartInfo(runtimeResolution),
                runtimeResolution
            );
        } catch (Exception ex) {
            return new TsHostLaunchResult(false, false, false, ex.Message);
        }
    }

    private static ProcessStartInfo CreateStartInfo(ProductRuntimeResolution runtimeResolution) {
        var startInfo = new ProcessStartInfo(runtimeResolution.HostExecutablePath) {
            WorkingDirectory = Path.GetDirectoryName(runtimeResolution.HostExecutablePath) ?? AppContext.BaseDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.EnvironmentVariables[HostLaneVariable] = ToHostLane(runtimeResolution.RuntimeLane);
        return startInfo;
    }

    private static TsHostLaunchResult StartAndWait(
        ProcessStartInfo startInfo,
        ProductRuntimeResolution runtimeResolution
    ) {
        var process = Process.Start(startInfo);
        var timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostStartupTimeoutMs);
        var deadlineUtc = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadlineUtc) {
            Thread.Sleep(250);
            var runningHost = TryGetRunningHostStatus();
            if (runningHost != null && MatchesRuntime(runningHost, runtimeResolution))
                return new TsHostLaunchResult(
                    true,
                    false,
                    true,
                    $"Started matching TS host: {Describe(runningHost)}"
                );
        }

        return new TsHostLaunchResult(
            false,
            false,
            true,
            $"Started TS host process {process?.Id.ToString() ?? "unknown"}, but {HostProcessIdentity.ResolveHostBaseUrl()} did not listen within {timeout.TotalSeconds:0.#} seconds."
        );
    }

    private static bool CanStartOver(RunningTsHostStatus runningHost, ProductRuntimeResolution runtimeResolution) =>
        runtimeResolution.RuntimeLane == ProductRuntimeLane.Dev
        && string.Equals(runningHost.Lane, "installed", StringComparison.OrdinalIgnoreCase);

    private static bool MatchesRuntime(
        RunningTsHostStatus runningHost,
        ProductRuntimeResolution runtimeResolution
    ) {
        if (!string.Equals(runningHost.Lane, ToHostLane(runtimeResolution.RuntimeLane), StringComparison.OrdinalIgnoreCase))
            return false;

        if (PathsEqual(runningHost.ExecutablePath, runtimeResolution.HostExecutablePath))
            return true;

        return runtimeResolution.RuntimeLane == ProductRuntimeLane.Dev
               && !string.IsNullOrWhiteSpace(runningHost.SourceRoot);
    }

    private static RunningTsHostStatus? TryGetRunningHostStatus() {
        try {
            var baseUrl = HostProcessIdentity.ResolveHostBaseUrl().TrimEnd('/');
            using var response = HttpClient.GetAsync($"{baseUrl}/host/status").GetAwaiter().GetResult();
            if (!response.IsSuccessStatusCode)
                return null;

            var responseText = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
            using var document = JsonDocument.Parse(responseText);
            var root = document.RootElement;
            return new RunningTsHostStatus(
                TryGetString(root, "lane"),
                TryGetString(root, "executablePath"),
                TryGetString(root, "sourceRoot"),
                TryGetInt(root, "processId")
            );
        } catch {
            return null;
        }
    }

    private static string ToHostLane(ProductRuntimeLane lane) => lane switch {
        ProductRuntimeLane.Dev => "dev",
        ProductRuntimeLane.Installed => "installed",
        _ => lane.ToString().ToLowerInvariant()
    };

    private static string Describe(ProductRuntimeResolution runtimeResolution) =>
        $"{runtimeResolution.RuntimeLane} host '{runtimeResolution.HostExecutablePath}' from {runtimeResolution.Source}";

    private static string Describe(RunningTsHostStatus status) {
        var lane = string.IsNullOrWhiteSpace(status.Lane) ? "unknown lane" : status.Lane;
        var executable = string.IsNullOrWhiteSpace(status.ExecutablePath)
            ? "unknown executable"
            : status.ExecutablePath;
        var process = status.ProcessId is null ? "unknown process" : $"process {status.ProcessId.Value}";
        return $"{lane} host '{executable}' ({process})";
    }

    private static bool PathsEqual(string? left, string? right) {
        if (string.IsNullOrWhiteSpace(left) || string.IsNullOrWhiteSpace(right))
            return false;
        return string.Equals(NormalizePath(left), NormalizePath(right), StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePath(string path) {
        try {
            return Path.GetFullPath(path);
        } catch {
            return path;
        }
    }

    private static string? TryGetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static int? TryGetInt(JsonElement element, string propertyName) {
        if (!element.TryGetProperty(propertyName, out var property))
            return null;
        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var value))
            return value;
        return null;
    }

    private sealed record RunningTsHostStatus(
        string? Lane,
        string? ExecutablePath,
        string? SourceRoot,
        int? ProcessId
    );
}

internal sealed record TsHostLaunchResult(
    bool Success,
    bool AlreadyRunning,
    bool StartedProcess,
    string Message
);
