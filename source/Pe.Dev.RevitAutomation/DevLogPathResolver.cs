using Pe.Shared.SettingsLayout;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public static class DevLogPathResolver {
    private static string BasePath => SettingsStorageLocations.GetDefaultBasePath();

    public static string HostLogPath => GlobalStorageLocations.ResolveHostLogPath(BasePath);

    public static string RevitAppLogPath => GlobalStorageLocations.ResolveRevitAppLogPath(BasePath);

    public static string RevitApprovalWatcherLogPath =>
        Path.Combine(
            Path.GetDirectoryName(RevitAppLogPath)
            ?? throw new InvalidOperationException("Could not resolve the global log directory."),
            "revit-approval-watcher.log.txt"
        );
}