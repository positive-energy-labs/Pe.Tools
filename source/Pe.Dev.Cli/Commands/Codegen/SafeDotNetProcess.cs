using Pe.Dev.RevitAutomation;
using System.Diagnostics;

namespace Pe.Dev.Cli.Codegen;

internal static class SafeDotNetProcess {
    public static ProcessStartInfo Create(string workingDirectory, params string[] dotnetArgs) {
        var repoRoot = RepoRootResolver.Resolve(null);
        if (OperatingSystem.IsWindows()) {
            var safeScriptPath = Path.Combine(repoRoot, "tools", "dotnet-sandbox-safe.ps1");
            if (File.Exists(safeScriptPath)) {
                var startInfo = new ProcessStartInfo("powershell") {
                    WorkingDirectory = workingDirectory,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                startInfo.ArgumentList.Add("-NoProfile");
                startInfo.ArgumentList.Add("-ExecutionPolicy");
                startInfo.ArgumentList.Add("Bypass");
                startInfo.ArgumentList.Add("-File");
                startInfo.ArgumentList.Add(safeScriptPath);
                foreach (var arg in dotnetArgs)
                    startInfo.ArgumentList.Add(arg);
                return startInfo;
            }
        }

        var dotnetStartInfo = new ProcessStartInfo("dotnet") {
            WorkingDirectory = workingDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var arg in dotnetArgs)
            dotnetStartInfo.ArgumentList.Add(arg);
        return dotnetStartInfo;
    }
}
