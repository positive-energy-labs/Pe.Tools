using Pe.Revit.Loader;
using Pe.Shared.Product;
using Pe.Shared.HostContracts;
using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace Pe.App.Host;

internal static class TsHostLauncher {
    private const string HostServiceName = HostProcessIdentity.ServiceName;

    // PE_LANE is the SDK-owned single lane signal the TS host reads (host-ownership.ts
    // resolveHostLane). The dev-lane launcher sets it here; the installed lane rides
    // InstalledProduct.EnsureRunning, which sets PE_LANE itself. The retired PE_TOOLS_HOST_LANE
    // product variable is gone (IPC-SEAM-SPEC D7).
    private const string LaneEnvironmentVariable = "PE_LANE";

    // Canonical dev launch spelling. The manifest's host `dev` field is the source of truth (D5,
    // read through the loader); this is only the fallback when the checkout manifest cannot be read.
    private const string DevHostCommandFallback = "vp run @pe/host#start";

    private static readonly HttpClient HttpClient = new() {
        Timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostProbeTimeoutMs)
    };

    public static TsHostLaunchResult EnsureRunning() {
        try {
            // Identity + liveness come from the runtime service file + SDK ProbeHealth, never the
            // /host/status body (D4 — /host/status is diagnostics only). A healthy DEV host is the shared
            // host: no Revit payload — an installed sandbox beside a dev RRD included — evicts it (D4/D6).
            // This replaces the old status-body short-circuit that treated any listener as "already up".
            var file = ServiceFile.Read(ResolveAppBase(), HostServiceName);
            if (file is not null
                && string.Equals(file.Lane, "dev", StringComparison.OrdinalIgnoreCase)
                && ProbeHealth(file.Port)) {
                return new TsHostLaunchResult(
                    true,
                    true,
                    false,
                    $"Sharing the running dev host: {DescribeFile(file)}"
                );
            }

            // Installed lane: the SDK service primitive owns discover/probe/spawn from the manifest's
            // `service` block and the runtime service file — no hardcoded port, file-based identity
            // (ServiceFile.Read + Matches + ProbeHealth). Dev lane stays hand-rolled (dev is not the
            // SDK's job: source `vp run`, dev-host reuse, installed-host takeover).
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
    ///     use. Prefers the actual bound port from the runtime service file (A10); falls back to
    ///     <c>PE_TOOLS_HOST_BASE_URL</c> / the 5180 default when no service file is present (before the
    ///     host has bound).
    /// </summary>
    public static string ResolveHostBaseUrl() {
        var port = ServiceFile.Read(ResolveAppBase(), HostServiceName)?.Port;
        return port is int value
            ? $"http://127.0.0.1:{value}"
            : HostProcessIdentity.ResolveHostBaseUrl();
    }

    private static string ResolveAppBase() =>
        PeRuntimeContext.Deployment?.AppBase ?? ProductRuntimeLayout.ForCurrentUser().RootPath;

    private static TsHostLaunchResult EnsureInstalledHostRunning(InstalledProduct deployment) {
        // No PE_LANE guard and no legacy 8s timeout: the loader pins this deployment's lane to
        // "installed" (SDK D1), and the SDK default startup budget (15s) fits a host that boots
        // the Mastra runtime (D11). EnsureRunning does file-based identity + ProbeHealth + spawn.
        var result = deployment.EnsureRunning(HostServiceName);
        if (!result.Ok || result.File is null) {
            return new TsHostLaunchResult(
                false,
                false,
                false,
                result.Reason ?? "Host service could not be started."
            );
        }

        // Downstream host-URL consumers (bridge, /call, schemas) resolve the bound port from the
        // service file via HostProcessIdentity.ResolveHostBaseUrl — no env-var republication.
        var baseUrl = $"http://127.0.0.1:{result.File.Port}";

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
        var hostExecutablePath = runtimeResolution.HostExecutablePath;
        if (!File.Exists(hostExecutablePath)) {
            if (runtimeResolution.SourceHostWorkingDirectory is { } sourceHostWorkingDirectory)
                return StartAndWait(
                    CreateSourceStartInfo(sourceHostWorkingDirectory),
                    runtimeResolution
                );

            return new TsHostLaunchResult(
                false,
                false,
                false,
                $"{runtimeResolution.RuntimeLane} TS host was not found: {hostExecutablePath}"
            );
        }

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
        startInfo.EnvironmentVariables[LaneEnvironmentVariable] = ToHostLane(runtimeResolution.RuntimeLane);
        return startInfo;
    }

    private static ProcessStartInfo CreateSourceStartInfo(string workingDirectory) {
        // A clean dev checkout may not have a staged Pe.Host.exe. The dev launch command is
        // manifest-declared (D5): read the host payload's `dev` field from the checkout's
        // product.payloads.json through the loader instead of hardcoding the spelling, and spawn it
        // in-process (no shelling out to the pe-revit CLI). Launching source is not a build/converge
        // action and must never mutate the live Revit session.
        var (fileName, arguments) = ResolveDevHostCommand(workingDirectory);
        var startInfo = new ProcessStartInfo(fileName, arguments) {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        startInfo.EnvironmentVariables[LaneEnvironmentVariable] = "dev";
        startInfo.EnvironmentVariables["PE_TOOLS_HOST_SOURCE_DIR"] = workingDirectory;
        return startInfo;
    }

    // The dev host working dir is <checkoutRoot>/source/pe-tools; the manifest lives at the checkout
    // root. Read the host payload's `dev` command via the loader (D5 {root}-substitution grammar) and
    // split it into an executable + argument string for an in-process spawn.
    private static (string FileName, string Arguments) ResolveDevHostCommand(string workingDirectory) {
        var checkoutRoot = Path.GetFullPath(Path.Combine(workingDirectory, "..", ".."));
        var command = InstalledProduct.Open(checkoutRoot)?.DevCommand(HostServiceName, checkoutRoot)
                      ?? DevHostCommandFallback;
        var trimmed = command.Trim();
        var split = trimmed.IndexOf(' ');
        return split < 0
            ? (trimmed, string.Empty)
            : (trimmed.Substring(0, split), trimmed.Substring(split + 1));
    }

    private static TsHostLaunchResult StartAndWait(
        ProcessStartInfo startInfo,
        PeRuntimeTarget runtimeResolution
    ) {
        var appBase = ResolveAppBase();
        var process = Process.Start(startInfo);
        var timeout = TimeSpan.FromMilliseconds(HostRuntimeDefaults.DefaultHostStartupTimeoutMs);
        var deadlineUtc = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadlineUtc) {
            Thread.Sleep(250);
            // Poll the service file (file appears → probe), not the HTTP status body (D4). A startup
            // timeout now means "no healthy dev service file appeared", not "status never answered".
            var file = ServiceFile.Read(appBase, HostServiceName);
            if (file is null) continue;
            if (!ProbeHealth(file.Port)) continue;
            if (MatchesDevTarget(file, runtimeResolution))
                return new TsHostLaunchResult(
                    true,
                    false,
                    true,
                    $"Started matching TS host: {DescribeFile(file)}"
                );
        }

        return new TsHostLaunchResult(
            false,
            false,
            true,
            $"Started TS host process {process?.Id.ToString() ?? "unknown"}, but no healthy dev service file appeared within {timeout.TotalSeconds:0.#} seconds."
        );
    }

    // Dev-lane identity from the service file (D4): the file's lane is dev AND the running image is this
    // checkout's host — a staged Pe.Host.exe (executablePath match) or a source `vp run` from this
    // checkout (sourceRoot match, set from PE_TOOLS_HOST_SOURCE_DIR = the working dir). The dev host's
    // own executablePath is node/vp, so sourceRoot is the load-bearing dev-lane signal.
    private static bool MatchesDevTarget(ServiceFile file, PeRuntimeTarget runtimeResolution) {
        if (!string.Equals(file.Lane, ToHostLane(runtimeResolution.RuntimeLane), StringComparison.OrdinalIgnoreCase))
            return false;
        if (PathsEqual(file.ExecutablePath, runtimeResolution.HostExecutablePath))
            return true;
        return runtimeResolution.SourceHostWorkingDirectory is { } dir && PathsEqual(file.SourceRoot, dir);
    }

    // SDK-parity health probe: a loopback GET on the file's ACTUAL bound port (never a hardcoded port,
    // never the /host/status body). 2xx/3xx ⇒ up. Mirrors InstalledProduct.ProbeHealth.
    private static bool ProbeHealth(int port) {
        try {
            using var response = HttpClient
                .GetAsync($"http://127.0.0.1:{port}{HostProcessIdentity.HealthPath}")
                .GetAwaiter().GetResult();
            return (int)response.StatusCode < 400;
        } catch {
            return false;
        }
    }

    private static string ToHostLane(ProductRuntimeLane lane) => lane switch {
        ProductRuntimeLane.Dev => "dev",
        ProductRuntimeLane.Installed => "installed",
        _ => lane.ToString().ToLowerInvariant()
    };

    private static string DescribeFile(ServiceFile file) {
        var lane = string.IsNullOrWhiteSpace(file.Lane) ? "unknown lane" : file.Lane;
        var executable = string.IsNullOrWhiteSpace(file.ExecutablePath)
            ? "unknown executable"
            : file.ExecutablePath;
        return $"{lane} host '{executable}' (pid {file.Pid}) on http://127.0.0.1:{file.Port}";
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
}

internal sealed record TsHostLaunchResult(
    bool Success,
    bool AlreadyRunning,
    bool StartedProcess,
    string Message
);
