using System.Diagnostics;
using Pe.Shared.Product;

namespace Pe.Host.Tray;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        try {
            var (lane, root, rest) = ParseOwner(args);
            ProductRuntimeLayout.Configure(lane, root);
            args = rest;
            if (args.Length == 2 && args[0] == "--launch-window")
                return PwaLauncher.LaunchWindowAsync(args[1]).GetAwaiter().GetResult();
            var launch = TrayLaunch.Parse(args);
            if (launch.IsDev != (ProductRuntimeLayout.Current.Lane == ProductLane.Dev)
                || launch.IsDev && !string.Equals(launch.SourceRoot, Path.GetFullPath(ProductRuntimeLayout.Current.OwnerRoot), StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("The tray launch does not belong to its --lane/--root owner.");
            using var parent = Process.GetProcessById(launch.ParentPid);
            if (parent.HasExited || !launch.MatchesParent(parent.Id, parent.StartTime.ToUniversalTime()))
                return 1;
            var service = launch.ReadService();
            using var singleton = new TraySingleton(launch);
            if (!singleton.IsOwner) return !launch.ShowOnStart || singleton.ShowAsync(launch.Route).GetAwaiter().GetResult() ? 0 : 1;
            TrayIdentity.Apply(launch);
            ApplicationConfiguration.Initialize();
            using var tray = new TrayContext(launch, service, parent);
            _ = Task.Run(() => singleton.ListenAsync(tray.RequestShow));
            Application.Run(tray);
            return 0;
        } catch (Exception error) when (error is ArgumentException or FormatException or InvalidDataException
                                       or System.Text.Json.JsonException or IOException
                                       or UnauthorizedAccessException or KeyNotFoundException
                                       or InvalidOperationException or System.ComponentModel.Win32Exception or HttpRequestException
                                       or OperationCanceledException or System.Security.SecurityException) {
            return 1;
        }
    }

    /// <summary>
    ///     Every launcher (installed host, dev host, dev-tray supervisor and script) tells the tray its
    ///     owner as a leading <c>--lane dev|installed --root &lt;checkout or install root&gt;</c>; the tray
    ///     never infers it from where its own bytes sit.
    /// </summary>
    internal static (ProductLane Lane, string Root, string[] Launch) ParseOwner(string[] args) {
        if (args.Length < 4 || args[0] != "--lane" || args[2] != "--root" || !Path.IsPathFullyQualified(args[3]))
            throw new ArgumentException("Expected --lane <dev|installed> --root <absolute owner root> before the launch arguments.");
        var lane = args[1] switch {
            "dev" => ProductLane.Dev,
            "installed" => ProductLane.Installed,
            _ => throw new ArgumentException($"Unknown tray lane '{args[1]}'.")
        };
        return (lane, args[3], args[4..]);
    }
}