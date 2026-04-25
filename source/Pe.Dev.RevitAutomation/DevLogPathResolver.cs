using Pe.Shared.SettingsLayout;
using System.IO;

namespace Pe.Dev.RevitAutomation;

public static class DevLogPathResolver {
    public static string HostLogPath => GlobalStorageLocations.ResolveHostLogPath();

    public static string RevitAppLogPath => GlobalStorageLocations.ResolveRevitAppLogPath();

    public static string RevitApprovalWatcherLogPath =>
        Path.Combine(
            DeploymentRuntimeLocations.GetLogRootPath(),
            "revit-approval-watcher.log.txt"
        );
}
