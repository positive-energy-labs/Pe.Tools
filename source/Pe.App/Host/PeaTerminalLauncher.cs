using Pe.Shared.Product;
using Serilog;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Host;

internal sealed record PeaTerminalLaunchResult(
    bool Success,
    string Message
);

internal static class PeaTerminalLauncher {
    public static PeaTerminalLaunchResult LaunchAgent(string workspaceKey = ScriptingWorkspaceLayout.DefaultWorkspaceKey) {
        var runtimeResolution = ProductRuntimeAuthority.ResolveForExecutingPeAppAssembly(
            typeof(PeaTerminalLauncher).Assembly.Location
        );
        var launcherPath = runtimeResolution.PeaLauncherPath;
        if (!File.Exists(launcherPath)) {
            return new PeaTerminalLaunchResult(
                false,
                $"Could not locate pea at '{launcherPath}'. Install {ProductIdentity.ProductName} or run `pe-dev pea link-dev` from the repo."
            );
        }

        try {
            var workingDirectory = Path.GetDirectoryName(launcherPath)
                                   ?? throw new InvalidOperationException("Resolved pea path had no directory.");
            var runtimeFlag = runtimeResolution.RuntimeLane == ProductRuntimeLane.Dev
                ? "--dev"
                : "--installed";
            var startInfo = new ProcessStartInfo("cmd.exe") {
                Arguments = $"/k \"\"{launcherPath}\" {runtimeFlag} agent --workspace {workspaceKey}\"",
                WorkingDirectory = workingDirectory,
                UseShellExecute = true,
                CreateNoWindow = false
            };
            _ = Process.Start(startInfo);
            Log.Information(
                "Launched pea agent terminal: LauncherPath={LauncherPath}, WorkspaceKey={WorkspaceKey}, RuntimeLane={RuntimeLane}, Source={Source}",
                launcherPath,
                workspaceKey,
                runtimeResolution.RuntimeLane,
                runtimeResolution.Source
            );
            return new PeaTerminalLaunchResult(true, "Opened pea agent in a terminal window.");
        } catch (Exception ex) {
            Log.Error(ex, "Failed to launch pea agent terminal: LauncherPath={LauncherPath}", launcherPath);
            return new PeaTerminalLaunchResult(false, $"Could not launch pea agent: {ex.Message}");
        }
    }
}
