using Pe.Revit.Loader;
using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Host;

/// <summary>
///     Starts or shares the TS host for the lane the SDK loaded this payload into. Lane, install
///     root, and checkout root are SDK facts on <see cref="PePayloadContext" />, captured once at
///     Startup; the supervisor ladder (lease, probe, match, stop stale, spawn, wait) is the SDK's
///     <see cref="InstalledProduct.EnsureRunning(string, string, ServiceSpec, ProcessStartInfo, string, string?, Func{ServiceFile, bool}, TimeSpan?)" />.
///     This type only names the process to run and what a matching service file looks like.
/// </summary>
internal static class TsHostLauncher {
    private const string SourceRootEnvironmentVariable = "PE_TOOLS_SOURCE_ROOT";
    /// <summary>The checkout's TS workspace, where the dev host runs. Mirror: TS <c>checkoutLayout.ts</c>.</summary>
    private const string TsWorkspaceDirectory = "ts";
    private static readonly TimeSpan DevStartupTimeout = TimeSpan.FromSeconds(90); // vite cold-starts in 40-60 s

    private static PePayloadContext? _context;

    public static string Lane => Context.Lane;

    private static PePayloadContext Context =>
        _context ?? throw new InvalidOperationException("TsHostLauncher.Capture must run in Startup before the host is resolved.");

    public static void Capture(PePayloadContext context) {
        _context = context;
        // Pin only the process-local NAME; the port is re-read from the service file on every
        // resolve so a takeover/restart can never leave a stale address behind.
        HostEndpoint.ConfiguredServiceName = ServiceName;
    }

    public static TsHostLaunchResult EnsureRunning() {
        try {
            var result = Context.Lane == "installed" ? EnsureInstalled() : EnsureDev();
            return result.State switch {
                ServiceRunState.Running => new TsHostLaunchResult(true, true, false, $"Sharing the running host: {Describe(result.File!)}"),
                ServiceRunState.Started => new TsHostLaunchResult(true, false, true, $"Started {Context.Lane} host: {Describe(result.File!)}"),
                _ => new TsHostLaunchResult(false, false, false, result.Reason ?? "The host could not be started.")
            };
        } catch (Exception ex) {
            return new TsHostLaunchResult(false, false, false, ex.Message);
        }
    }

    public static string ResolveHostBaseUrl() => HostEndpoint.ResolveHostBaseUrl();

    /// <summary>The checkout root is the dev service identity, the same string every TS deriver hashes.</summary>
    private static string ServiceName => HostEndpoint.ResolveServiceName(Context.Lane, Context.SourceRoot);

    private static ServiceResult EnsureInstalled() {
        var product = InstalledProduct.Open(Context.InstallRoot!)
            ?? throw new InvalidOperationException($"No product manifest at '{Context.InstallRoot}'; reinstall Pe.Tools.");
        return product.EnsureRunning(HostEndpoint.ServiceName);
    }

    private static ServiceResult EnsureDev() {
        var sourceRoot = Context.SourceRoot
            ?? throw new InvalidOperationException("The dev lane requires a checkout source root from the session descriptor.");
        var workingDirectory = Path.Combine(sourceRoot, TsWorkspaceDirectory);
        // Fresh worktrees don't share node_modules; without this the spawned host dies instantly
        // and the supervisor blind-waits the full timeout with no cause in the message.
        if (!Directory.Exists(Path.Combine(workingDirectory, "node_modules")))
            throw new InvalidOperationException($"'{workingDirectory}' has no node_modules; run `vp i` there, then retry.");

        var manifest = InstalledProduct.Open(sourceRoot)
            ?? throw new InvalidOperationException($"No product.payloads.json at '{sourceRoot}'.");
        var spec = manifest.Service(HostEndpoint.ServiceName)
            ?? throw new InvalidOperationException("The checkout manifest declares no host service block.");
        var command = manifest.DevCommand(HostEndpoint.ServiceName, sourceRoot)
            ?? throw new InvalidOperationException("The checkout manifest declares no host dev command.");
        var split = command.IndexOf(' ');
        var start = new ProcessStartInfo(split < 0 ? command : command.Substring(0, split), split < 0 ? "" : command.Substring(split + 1)) {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        start.EnvironmentVariables[HostEndpoint.ServiceNameVariable] = ServiceName;
        start.EnvironmentVariables[SourceRootEnvironmentVariable] = sourceRoot;

        var appBase = InstalledProduct.AppBaseFor(ProductIdentity.ProductName, ProductIdentity.VendorName);
        return InstalledProduct.EnsureRunning(
            appBase, ServiceName, spec, start, Context.Lane, null,
            file => file.Lane == "dev" && PathsEqual(file.SourceRoot, sourceRoot),
            DevStartupTimeout);
    }

    private static string Describe(ServiceFile file) =>
        $"{file.Lane} host '{file.ExecutablePath ?? "unknown executable"}' (pid {file.Pid}) on http://127.0.0.1:{file.Port}";

    private static bool PathsEqual(string? left, string right) =>
        !string.IsNullOrWhiteSpace(left)
        && string.Equals(Path.GetFullPath(left!).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase);
}

internal sealed record TsHostLaunchResult(bool Success, bool AlreadyRunning, bool StartedProcess, string Message);
