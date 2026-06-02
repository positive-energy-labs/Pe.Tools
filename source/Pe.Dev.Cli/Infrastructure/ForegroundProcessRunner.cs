using System.Diagnostics;

namespace Pe.Dev.Cli;

internal static class ForegroundProcessRunner {
    private const int CapturedLineLimit = 200;

    public static async Task<int> RunAsync(ProcessStartInfo startInfo, CancellationToken cancellationToken) =>
        (await RunDetailedAsync(startInfo, echoOutput: true, cancellationToken)).ExitCode;

    public static async Task<ForegroundProcessResult> RunDetailedAsync(
        ProcessStartInfo startInfo,
        bool echoOutput,
        CancellationToken cancellationToken,
        Action<string>? stdoutLine = null,
        Action<string>? stderrLine = null,
        Action<Process>? processStarted = null,
        Action<Process, TimeSpan>? heartbeat = null,
        Action<string>? diagnosticLine = null
    ) {
        DisableMsBuildNodeReuse(startInfo);

        var stdout = new Queue<string>();
        var stderr = new Queue<string>();
        using var process = new Process {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += (_, args) => {
            if (args.Data is null)
                return;
            Capture(stdout, args.Data);
            stdoutLine?.Invoke(args.Data);
            if (echoOutput)
                Console.Out.WriteLine(args.Data);
        };
        process.ErrorDataReceived += (_, args) => {
            if (args.Data is null)
                return;
            Capture(stderr, args.Data);
            stderrLine?.Invoke(args.Data);
            if (echoOutput)
                Console.Error.WriteLine(args.Data);
        };

        if (!process.Start())
            throw new InvalidOperationException($"Failed to start process '{startInfo.FileName}'.");
        processStarted?.Invoke(process);

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var heartbeatCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var heartbeatTask = heartbeat is null
            ? Task.CompletedTask
            : RunHeartbeatAsync(process, heartbeat, heartbeatCts.Token);

        try {
            await process.WaitForExitAsync(cancellationToken);
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            await KillTimedOutProcessAsync(process, diagnosticLine);
            throw;
        } finally {
            await heartbeatCts.CancelAsync();
            await heartbeatTask;
        }
        return new ForegroundProcessResult(process.ExitCode, stdout.ToArray(), stderr.ToArray());
    }

    private static async Task KillTimedOutProcessAsync(Process process, Action<string>? diagnosticLine) {
        diagnosticLine?.Invoke($"timeout-kill-start pid={process.Id} hasExited={SafeHasExited(process)}");
        if (SafeHasExited(process))
            return;

        TryKillProcessTree(process, diagnosticLine, "dotnet-kill");
        if (await WaitForExitAsync(process, TimeSpan.FromSeconds(5))) {
            diagnosticLine?.Invoke($"timeout-kill-complete pid={process.Id}");
            return;
        }

        if (OperatingSystem.IsWindows()) {
            await RunWindowsTaskKillAsync(process.Id, diagnosticLine);
            if (await WaitForExitAsync(process, TimeSpan.FromSeconds(5))) {
                diagnosticLine?.Invoke($"timeout-taskkill-complete pid={process.Id}");
                return;
            }
        }

        diagnosticLine?.Invoke($"timeout-kill-incomplete pid={process.Id} hasExited={SafeHasExited(process)}");
    }

    private static void TryKillProcessTree(Process process, Action<string>? diagnosticLine, string label) {
        try {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        } catch (Exception ex) {
            diagnosticLine?.Invoke($"{label}-failed pid={process.Id} {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static async Task RunWindowsTaskKillAsync(int processId, Action<string>? diagnosticLine) {
        try {
            using var taskKill = Process.Start(new ProcessStartInfo {
                FileName = "taskkill.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                ArgumentList = { "/PID", processId.ToString(), "/T", "/F" }
            });
            if (taskKill is null) {
                diagnosticLine?.Invoke($"taskkill-start-failed pid={processId}");
                return;
            }

            var completed = await WaitForExitAsync(taskKill, TimeSpan.FromSeconds(5));
            diagnosticLine?.Invoke($"taskkill exitCode={(completed ? taskKill.ExitCode.ToString() : "timeout")} pid={processId}");
        } catch (Exception ex) {
            diagnosticLine?.Invoke($"taskkill-failed pid={processId} {ex.GetType().Name}: {ex.Message}");
        }
    }

    private static async Task<bool> WaitForExitAsync(Process process, TimeSpan timeout) {
        try {
            var waitTask = process.WaitForExitAsync();
            var completed = await Task.WhenAny(waitTask, Task.Delay(timeout)) == waitTask;
            if (completed)
                await waitTask;
            return completed;
        } catch {
            return SafeHasExited(process);
        }
    }

    private static bool SafeHasExited(Process process) {
        try {
            return process.HasExited;
        } catch {
            return true;
        }
    }

    private static async Task RunHeartbeatAsync(
        Process process,
        Action<Process, TimeSpan> heartbeat,
        CancellationToken cancellationToken
    ) {
        var startUtc = DateTime.UtcNow;
        while (!cancellationToken.IsCancellationRequested) {
            try {
                await Task.Delay(TimeSpan.FromSeconds(10), cancellationToken);
                if (!process.HasExited)
                    heartbeat(process, DateTime.UtcNow - startUtc);
            } catch (OperationCanceledException) {
                return;
            }
        }
    }

    private static void Capture(Queue<string> lines, string line) {
        lines.Enqueue(line);
        while (lines.Count > CapturedLineLimit)
            lines.Dequeue();
    }

    private static void DisableMsBuildNodeReuse(ProcessStartInfo startInfo) {
        if (!startInfo.Environment.ContainsKey("MSBUILDDISABLENODEREUSE"))
            startInfo.Environment["MSBUILDDISABLENODEREUSE"] = "1";
    }
}

internal sealed record ForegroundProcessResult(int ExitCode, IReadOnlyList<string> StdoutTail, IReadOnlyList<string> StderrTail);
