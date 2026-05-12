using System.Diagnostics;
using System.Reflection;

namespace Pe.Dev.Cli;

internal static class CliProcessRelauncher {
    public static BackgroundLaunchResult StartBackground(IReadOnlyList<string> forwardedArguments) {
        var startInfo = CreateStartInfo(forwardedArguments);
        startInfo.UseShellExecute = true;
        startInfo.WindowStyle = ProcessWindowStyle.Hidden;
        startInfo.CreateNoWindow = false;

        try {
            var process = Process.Start(startInfo);
            return process is null
                ? BackgroundLaunchResult.Failure("Failed to start approval watcher.", 1)
                : BackgroundLaunchResult.SuccessResult($"Approval watcher started (PID: {process.Id}).");
        } catch (Exception ex) {
            return BackgroundLaunchResult.Failure($"Failed to start approval watcher: {ex.Message}", 1);
        }
    }

    private static ProcessStartInfo CreateStartInfo(IReadOnlyList<string> forwardedArguments) {
        var entryAssemblyPath = Assembly.GetEntryAssembly()?.Location
                                ?? throw new InvalidOperationException("Could not resolve the pe-dev assembly path.");
        var processPath = Environment.ProcessPath
                          ?? throw new InvalidOperationException("Could not resolve the current process path.");

        var startInfo = new ProcessStartInfo();
        if (Path.GetFileNameWithoutExtension(processPath).Equals("dotnet", StringComparison.OrdinalIgnoreCase)) {
            startInfo.FileName = processPath;
            startInfo.ArgumentList.Add("exec");
            startInfo.ArgumentList.Add(entryAssemblyPath);
        } else {
            startInfo.FileName = processPath;
        }

        foreach (var argument in forwardedArguments)
            startInfo.ArgumentList.Add(argument);

        return startInfo;
    }
}

internal readonly record struct BackgroundLaunchResult(bool Success, string Message, int ExitCode) {
    public static BackgroundLaunchResult SuccessResult(string message) => new(true, message, 0);
    public static BackgroundLaunchResult Failure(string message, int exitCode) => new(false, message, exitCode);
}
