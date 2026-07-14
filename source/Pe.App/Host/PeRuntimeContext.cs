using Pe.Revit.Loader;
using Pe.Shared.Product;
using Serilog;
using System;
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
    private static string? _sourceRoot;
    // Pre-capture placeholder. Reading Lane before Startup captured a context is a lifecycle bug —
    // the answer would be a guess — so the getter logs loudly rather than handing back a silent
    // default (IPC-SEAM-SPEC D7).
    private static ProductRuntimeLane _lane = ProductRuntimeLane.Installed;
    private static bool _captured;

    public static void Capture(PePayloadContext context) {
        _deployment = context.Deployment;
        _sourceRoot = context.SourceRoot;
        _lane = context.Deployment is null ? ProductRuntimeLane.Dev : ProductRuntimeLane.Installed;
        _captured = true;
    }

    public static ProductRuntimeLane Lane {
        get {
            if (!_captured)
                Log.Error(
                    "PeRuntimeContext.Lane read before Capture(); returning the pre-capture Installed placeholder. This is a startup-ordering bug — the lane is not yet known and must not be trusted.");
            return _lane;
        }
    }

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

        // Self-hosted dev lane: prefer the stable dev payload when tooling has materialized it.
        // The checkout path is also carried so a clean checkout can launch @pe/host directly;
        // launching source is not a build/converge action and must never touch the Revit lifecycle.
        var devHost = ProductDevelopmentRuntimeLayout.ForCurrentUser().Binaries.HostExecutablePath;
        return new PeRuntimeTarget(
            ProductRuntimeLane.Dev,
            devHost,
            "self-hosted-dev",
            ProductDevelopmentRuntimeLayout.ResolveSourceHostWorkingDirectory(_sourceRoot)
        );
    }
}

internal sealed record PeRuntimeTarget(
    ProductRuntimeLane RuntimeLane,
    string HostExecutablePath,
    string Source,
    string? SourceHostWorkingDirectory = null
);
