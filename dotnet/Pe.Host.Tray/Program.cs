using System.Diagnostics;

namespace Pe.Host.Tray;

internal static class Program {
    [STAThread]
    private static int Main(string[] args) {
        try {
            var launch = TrayLaunch.Parse(args);
            using var parent = Process.GetProcessById(launch.ParentPid);
            if (parent.HasExited || !launch.MatchesParent(parent.Id, parent.StartTime.ToUniversalTime()))
                return 1;
            var service = launch.ReadService();
            ApplicationConfiguration.Initialize();
            using var tray = new TrayContext(launch, service, parent);
            Application.Run(tray);
            return 0;
        } catch (Exception error) when (error is ArgumentException or FormatException or InvalidDataException
                                       or System.Text.Json.JsonException or IOException
                                       or UnauthorizedAccessException or KeyNotFoundException
                                       or InvalidOperationException or System.ComponentModel.Win32Exception) {
            return 1;
        }
    }
}
