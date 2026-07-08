using Pe.Revit.Loader;
using Pe.Shared.Product;
using System.IO;

namespace Pe.App.Host;

/// <summary>
///     The lane + install location this Pe.App payload was loaded into, captured once from the
///     <see cref="PePayloadContext" /> at Startup. Replaces the old runtime-descriptor probe: the
///     descriptor was never written, so resolution always fell through to a hardcoded Installed
///     default. The loader now hands us the honest answer at load time —
///     <see cref="PePayloadContext.Deployment" /> is non-null exactly in the installed lane, and the
///     dev lane is self-hosted (Revit loads Pe.App directly; no loader, no install root).
///     Installed-lane sibling payloads (host exe, pea launcher) resolve through the loader's
///     <see cref="InstalledProduct" />, the same on-disk grammar the installer wrote.
/// </summary>
internal static class PeRuntimeContext {
    private static InstalledProduct? _deployment;
    // Safe default before Startup captures a context (e.g. a command handler racing initialization).
    private static ProductRuntimeLane _lane = ProductRuntimeLane.Installed;

    public static void Capture(PePayloadContext context) {
        _deployment = context.Deployment;
        _lane = context.Deployment is null ? ProductRuntimeLane.Dev : ProductRuntimeLane.Installed;
    }

    public static ProductRuntimeLane Lane => _lane;

    /// <summary>
    ///     The installed product this payload was loaded into, or null in the self-hosted dev lane.
    ///     The installed-lane host lifecycle rides this through <c>InstalledProduct.EnsureRunning</c>.
    /// </summary>
    public static InstalledProduct? Deployment => _deployment;

    /// <summary>Resolve the host executable for the captured lane. Used by the dev-lane host launcher
    /// (the installed lane goes through <see cref="Deployment" />'s <c>EnsureRunning</c> instead).</summary>
    public static PeRuntimeTarget Resolve() {
        var deployment = _deployment;
        if (deployment is not null) {
            var host = deployment.Resolve("host")?.EntryPath
                       ?? Path.Combine(
                           deployment.AppBase,
                           ProductPathNames.BinDirectoryName,
                           HostProcessIdentity.DirectoryName,
                           HostProcessIdentity.ExecutableName
                       );
            return new PeRuntimeTarget(ProductRuntimeLane.Installed, host, "loader-deployment");
        }

        // Self-hosted dev lane: the dev host build written by the dev tooling. Kept on the
        // Pe.Shared.Product dev-layout surface (the SDK has no dev-lane concept yet).
        var devHost = ProductDevelopmentRuntimeLayout.ForCurrentUser().Binaries.HostExecutablePath;
        return new PeRuntimeTarget(ProductRuntimeLane.Dev, devHost, "self-hosted-dev");
    }
}

internal sealed record PeRuntimeTarget(
    ProductRuntimeLane RuntimeLane,
    string HostExecutablePath,
    string Source
);
