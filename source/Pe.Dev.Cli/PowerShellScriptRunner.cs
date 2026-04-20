using System.Diagnostics;

namespace Pe.Dev.Cli;

internal static class PowerShellScriptRunner
{
    public static async Task<int> RunForegroundAsync(
        string scriptPath,
        IReadOnlyList<string> forwardedArguments,
        CancellationToken cancellationToken
    )
    {
        if (!File.Exists(scriptPath))
        {
            Console.Error.WriteLine($"Script not found: {scriptPath}");
            return 10;
        }

        var startInfo = CreateStartInfo(scriptPath, forwardedArguments, useShellExecute: false);
        startInfo.RedirectStandardOutput = true;
        startInfo.RedirectStandardError = true;

        using var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is not null)
            {
                Console.Out.WriteLine(e.Data);
            }
        };

        process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is not null)
            {
                Console.Error.WriteLine(e.Data);
            }
        };

        if (!process.Start())
        {
            Console.Error.WriteLine($"Failed to start script: {scriptPath}");
            return 1;
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);
        return process.ExitCode;
    }

    public static BackgroundLaunchResult StartBackground(string scriptPath, IReadOnlyList<string> forwardedArguments)
    {
        if (!File.Exists(scriptPath))
        {
            return BackgroundLaunchResult.Failure($"Script not found: {scriptPath}", 10);
        }

        var startInfo = CreateStartInfo(scriptPath, forwardedArguments, useShellExecute: true);
        startInfo.WindowStyle = ProcessWindowStyle.Minimized;
        startInfo.CreateNoWindow = false;

        try
        {
            var process = Process.Start(startInfo);
            return process is null
                ? BackgroundLaunchResult.Failure("ERROR: Failed to start auto-approval script.", 1)
                : BackgroundLaunchResult.SuccessResult($"Auto-approval script started (PID: {process.Id})");
        }
        catch (Exception ex)
        {
            return BackgroundLaunchResult.Failure($"ERROR launching auto-approval script: {ex.Message}", 1);
        }
    }

    private static ProcessStartInfo CreateStartInfo(
        string scriptPath,
        IReadOnlyList<string> forwardedArguments,
        bool useShellExecute
    )
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = useShellExecute
        };

        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-File");
        startInfo.ArgumentList.Add(scriptPath);

        foreach (var argument in forwardedArguments)
        {
            startInfo.ArgumentList.Add(argument);
        }

        return startInfo;
    }
}

internal readonly record struct BackgroundLaunchResult(bool Success, string Message, int ExitCode)
{
    public static BackgroundLaunchResult SuccessResult(string message) => new(true, message, 0);
    public static BackgroundLaunchResult Failure(string message, int exitCode) => new(false, message, exitCode);
}
