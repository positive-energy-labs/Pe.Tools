using Pe.Revit.Loader;
using Pe.Shared.Product;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Host;

internal static class TsHostLauncher {
    private const string LaneEnvironmentVariable = "PE_LANE";
    private const string SourceDirectoryEnvironmentVariable = "PE_TOOLS_HOST_SOURCE_DIR";
    private const string DevHostCommandFallback = "vp run @pe/host#dev";

    public static TsHostLaunchResult EnsureRunning() {
        try {
            var runtime = PeRuntimeContext.Resolve();
            var serviceName = ResolveServiceName(runtime);
            // Pin only the process-local NAME; the port/base-URL is re-read from the service file
            // on every resolve so a takeover/restart can never leave a stale address behind.
            HostProcessIdentity.ConfiguredServiceName = serviceName;
            var appBase = ResolveAppBase();

            if (runtime.RuntimeLane == ProductRuntimeLane.Dev) {
                var file = ServiceFile.Read(appBase, serviceName);
                if (file is not null && ProbeHealth(file.Port) && MatchesDevTarget(file, runtime))
                    return new TsHostLaunchResult(
                        true,
                        true,
                        false,
                        $"Sharing this checkout's running dev host: {DescribeFile(file)}"
                    );
            }

            return PeRuntimeContext.Deployment is { } deployment
                ? EnsureInstalledHostRunning(deployment, serviceName)
                : EnsureDevHostRunning(runtime, serviceName);
        } catch (Exception ex) {
            return new TsHostLaunchResult(false, false, false, ex.Message);
        }
    }

    public static string ResolveHostBaseUrl() {
        var runtime = PeRuntimeContext.Resolve();
        var serviceName = ResolveServiceName(runtime);
        var port = ServiceFile.Read(ResolveAppBase(), serviceName)?.Port;
        return port is int value
            ? $"http://127.0.0.1:{value}"
            : HostProcessIdentity.ResolveHostBaseUrl();
    }

    private static string ResolveServiceName(PeRuntimeTarget runtime) =>
        HostProcessIdentity.ResolveServiceName(
            runtime.RuntimeLane,
            runtime.SourceHostWorkingDirectory
        );

    private static string ResolveAppBase() =>
        PeRuntimeContext.Deployment?.AppBase ?? ProductRuntimeLayout.ForCurrentUser().RootPath;

    private static TsHostLaunchResult EnsureInstalledHostRunning(
        InstalledProduct deployment,
        string serviceName
    ) {
        var result = deployment.EnsureRunning(serviceName);
        if (!result.Ok || result.File is null)
            return new TsHostLaunchResult(
                false,
                false,
                false,
                result.Reason ?? "Host service could not be started."
            );

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

    private static TsHostLaunchResult EnsureDevHostRunning(
        PeRuntimeTarget runtime,
        string serviceName
    ) {
        if (runtime.SourceHostWorkingDirectory is not { } sourceHostWorkingDirectory)
            return new TsHostLaunchResult(
                false,
                false,
                false,
                "The dev host requires a checkout source root."
            );

        return StartAndWait(
            CreateSourceStartInfo(sourceHostWorkingDirectory, serviceName),
            runtime,
            serviceName
        );
    }

    private static ProcessStartInfo CreateSourceStartInfo(
        string workingDirectory,
        string serviceName
    ) {
        var (fileName, arguments) = ResolveDevHostCommand(workingDirectory);
        var startInfo = new ProcessStartInfo(fileName, arguments) {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        ApplyRuntimeEnvironment(
            startInfo,
            ProductRuntimeLane.Dev,
            workingDirectory,
            serviceName
        );
        return startInfo;
    }

    private static void ApplyRuntimeEnvironment(
        ProcessStartInfo startInfo,
        ProductRuntimeLane lane,
        string? sourceRoot,
        string serviceName
    ) {
        startInfo.EnvironmentVariables[LaneEnvironmentVariable] = ToHostLane(lane);
        startInfo.EnvironmentVariables[HostProcessIdentity.ServiceNameVariable] = serviceName;
        if (sourceRoot is not null)
            startInfo.EnvironmentVariables[SourceDirectoryEnvironmentVariable] = sourceRoot;
    }

    private static (string FileName, string Arguments) ResolveDevHostCommand(string workingDirectory) {
        var checkoutRoot = Path.GetFullPath(Path.Combine(workingDirectory, "..", ".."));
        var command = InstalledProduct.Open(checkoutRoot)?.DevCommand(
            HostProcessIdentity.ServiceName,
            checkoutRoot
        ) ?? DevHostCommandFallback;
        var trimmed = command.Trim();
        var split = trimmed.IndexOf(' ');
        return split < 0
            ? (trimmed, string.Empty)
            : (trimmed.Substring(0, split), trimmed.Substring(split + 1));
    }

    private static TsHostLaunchResult StartAndWait(
        ProcessStartInfo startInfo,
        PeRuntimeTarget runtime,
        string serviceName
    ) {
        var appBase = ResolveAppBase();
        var process = Process.Start(startInfo);
        var timeout = TimeSpan.FromSeconds(45);
        var deadlineUtc = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadlineUtc) {
            Thread.Sleep(250);
            var file = ServiceFile.Read(appBase, serviceName);
            if (file is null || !ProbeHealth(file.Port) || !MatchesDevTarget(file, runtime))
                continue;
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
            $"Started TS host process {process?.Id.ToString() ?? "unknown"}, but no healthy '{serviceName}' service file appeared within {timeout.TotalSeconds:0.#} seconds."
        );
    }

    private static bool MatchesDevTarget(ServiceFile file, PeRuntimeTarget runtime) {
        if (!string.Equals(file.Lane, ToHostLane(runtime.RuntimeLane), StringComparison.OrdinalIgnoreCase))
            return false;
        if (PathsEqual(file.ExecutablePath, runtime.HostExecutablePath))
            return true;
        return runtime.SourceHostWorkingDirectory is { } dir && PathsEqual(file.SourceRoot, dir);
    }

    // SDK-owned probe (public since beta.98) — one implementation, never re-rolled per consumer.
    private static bool ProbeHealth(int port) =>
        InstalledProduct.ProbeHealth(port, HostProcessIdentity.HealthPath);

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
