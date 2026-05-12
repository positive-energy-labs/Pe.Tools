using System.Diagnostics;

namespace Pe.Dev.Cli;

internal static class ForegroundProcessRunner {
    public static async Task<int> RunAsync(ProcessStartInfo startInfo, CancellationToken cancellationToken) {
        using var process = new Process {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += (_, args) => {
            if (args.Data is not null)
                Console.Out.WriteLine(args.Data);
        };
        process.ErrorDataReceived += (_, args) => {
            if (args.Data is not null)
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
        return process.ExitCode;
    }
}
