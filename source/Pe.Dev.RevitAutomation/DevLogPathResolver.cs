using System.IO;
using Pe.Shared.StorageRuntime;

namespace Pe.Dev.RevitAutomation;

public static class DevLogPathResolver {
    public static string HostLogPath => StorageClient.Default.Global().HostLog().FilePath;

    public static string RevitAppLogPath => StorageClient.Default.Global().RevitAppLog().FilePath;

    public static string RevitApprovalWatcherLogPath =>
        Path.Combine(
            Path.GetDirectoryName(RevitAppLogPath)
            ?? throw new InvalidOperationException("Could not resolve the global log directory."),
            "revit-approval-watcher.log.txt"
        );
}
