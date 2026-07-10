using Newtonsoft.Json.Linq;
using Pe.Revit.Loader;
using Pe.Shared.Product;
using Pe.Shared.HostContracts;
using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace Pe.App.Host;

internal static class TsHostLauncher {
    private const string HostServiceName = "host";
    private const string HostLaneVariable = "PE_TOOLS_HOST_LANE";
    private static readonly HttpClient HttpClient = new() {
        Timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostProbeTimeoutMs)
    };

    public static TsHostLaunchResult EnsureRunning() {
        try {
            // Installed lane: the SDK service primitive owns discover/probe/spawn from the manifest's
            // `service` block and the runtime service file — no hardcoded port. Dev lane stays hand-rolled
            // (dev is not the SDK's job: pnpm dev host, installed-host takeover).
            var deployment = PeRuntimeContext.Deployment;
            return deployment is not null
                ? EnsureInstalledHostRunning(deployment)
                : EnsureDevHostRunning(PeRuntimeContext.Resolve());
        } catch (Exception ex) {
            return new TsHostLaunchResult(false, false, false, ex.Message);
        }
    }

    /// <summary>
    ///     Resolve the base URL every in-process host caller (bridge WS, POST /call, schema fetch) should
    ///     use. Prefers the actual bound port from the runtime service file (installed lane, A10); falls
    ///     back to <c>PE_TOOLS_HOST_BASE_URL</c> / the 5180 default when no service file is present
    ///     (dev lane, or before the host has bound).
    /// </summary>
    public static string ResolveHostBaseUrl() {
        var port = TryReadServiceFilePort();
        return port is int value
            ? $"http://127.0.0.1:{value}"
            : HostProcessIdentity.ResolveHostBaseUrl();
    }

    private static int? TryReadServiceFilePort() {
        var deployment = PeRuntimeContext.Deployment;
        if (deployment is null)
            return null;
        return ServiceFile.Read(deployment.AppBase, HostServiceName)?.Port;
    }

    private static TsHostLaunchResult EnsureInstalledHostRunning(InstalledProduct deployment) {
        // No PE_LANE guard and no legacy 8s timeout: the loader pins this deployment's lane to
        // "installed" (SDK D1), and the SDK default startup budget (15s) fits a host that boots
        // the Mastra runtime (D11).
        var result = deployment.EnsureRunning(HostServiceName);
        if (!result.Ok || result.File is null) {
            return new TsHostLaunchResult(
                false,
                false,
                false,
                result.Reason ?? "Host service could not be started."
            );
        }

        // Publish the actual bound port so every downstream host-URL consumer (bridge, /call, schemas)
        // resolves to it instead of the 5180 default.
        var baseUrl = $"http://127.0.0.1:{result.File.Port}";
        Environment.SetEnvironmentVariable(HostProcessIdentity.HostBaseUrlVariable, baseUrl);

        var alreadyRunning = result.State == ServiceRunState.Running;
        return new TsHostLaunchResult(
            true,
            alreadyRunning,
            !alreadyRunning,
            alreadyRunning
                ? $"Matching host service is already listening: {baseUrl}"
                : $"Started host service: {baseUrl}"
            );
    }

    private static TsHostLaunchResult EnsureDevHostRunning(PeRuntimeTarget runtimeResolution) {
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
    }

    private static ProcessStartInfo CreateStartInfo(PeRuntimeTarget runtimeResolution) {
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
        PeRuntimeTarget runtimeResolution
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

    private static bool CanStartOver(RunningTsHostStatus runningHost, PeRuntimeTarget runtimeResolution) =>
        runtimeResolution.RuntimeLane == ProductRuntimeLane.Dev
        && string.Equals(runningHost.Lane, "installed", StringComparison.OrdinalIgnoreCase);

    private static bool MatchesRuntime(
        RunningTsHostStatus runningHost,
        PeRuntimeTarget runtimeResolution
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
            var root = JObject.Parse(responseText);
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

    private static string Describe(PeRuntimeTarget runtimeResolution) =>
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

    private static string? TryGetString(JObject element, string propertyName) =>
        element.TryGetValue(propertyName, out var property) && property.Type == JTokenType.String
            ? property.Value<string>()
            : null;

    private static int? TryGetInt(JObject element, string propertyName) {
        if (!element.TryGetValue(propertyName, out var property) || property.Type != JTokenType.Integer)
            return null;
        return property.Value<int?>();
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
