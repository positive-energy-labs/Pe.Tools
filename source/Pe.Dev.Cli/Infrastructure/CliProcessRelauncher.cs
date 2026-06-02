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
            using var process = Process.Start(startInfo);
            if (process is null)
                return BackgroundLaunchResult.Failure("Failed to start approval watcher.", 1);

            return BackgroundLaunchResult.SuccessResult(
                $"Approval watcher started (PID: {process.Id}).",
                process.Id,
                TryGetStartTimeUtc(process)
            );
        } catch (Exception ex) {
            return BackgroundLaunchResult.Failure($"Failed to start approval watcher: {ex.Message}", 1);
        }
    }

    private static DateTime? TryGetStartTimeUtc(Process process) {
        try {
            return process.StartTime.ToUniversalTime();
        } catch {
            return null;
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

internal readonly record struct BackgroundLaunchResult(bool Success, string Message, int ExitCode, int? ProcessId, DateTime? ProcessStartUtc) {
    public static BackgroundLaunchResult SuccessResult(string message, int processId, DateTime? processStartUtc) =>
        new(true, message, 0, processId, processStartUtc);

    public static BackgroundLaunchResult Failure(string message, int exitCode) =>
        new(false, message, exitCode, null, null);
}
