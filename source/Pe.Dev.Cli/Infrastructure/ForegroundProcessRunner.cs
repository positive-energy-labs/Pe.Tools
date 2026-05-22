using System.Diagnostics;

namespace Pe.Dev.Cli;

internal static class ForegroundProcessRunner {
    private const int CapturedLineLimit = 200;

    public static async Task<int> RunAsync(ProcessStartInfo startInfo, CancellationToken cancellationToken) =>
        (await RunDetailedAsync(startInfo, echoOutput: true, cancellationToken)).ExitCode;

    public static async Task<ForegroundProcessResult> RunDetailedAsync(
        ProcessStartInfo startInfo,
        bool echoOutput,
        CancellationToken cancellationToken
    ) {
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
            if (echoOutput)
                Console.Out.WriteLine(args.Data);
        };
        process.ErrorDataReceived += (_, args) => {
            if (args.Data is null)
                return;
            Capture(stderr, args.Data);
            if (echoOutput)
                Console.Error.WriteLine(args.Data);
        };

        if (!process.Start())
            throw new InvalidOperationException($"Failed to start process '{startInfo.FileName}'.");

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        using var registration = cancellationToken.Register(() => {
            try {
                if (!process.HasExited)
                    process.Kill(entireProcessTree: true);
            } catch {
                // Best effort cancellation.
            }
        });

        await process.WaitForExitAsync(cancellationToken);
        return new ForegroundProcessResult(process.ExitCode, stdout.ToArray(), stderr.ToArray());
    }

    private static void Capture(Queue<string> lines, string line) {
        lines.Enqueue(line);
        while (lines.Count > CapturedLineLimit)
            lines.Dequeue();
    }
}

internal sealed record ForegroundProcessResult(int ExitCode, IReadOnlyList<string> StdoutTail, IReadOnlyList<string> StderrTail);
