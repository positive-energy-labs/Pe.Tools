using System.Diagnostics;

namespace Pe.Host.Tray;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--launch-window")
                return PwaLauncher.LaunchWindowAsync(args[1]).GetAwaiter().GetResult();
            var launch = TrayLaunch.Parse(args);
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
}
