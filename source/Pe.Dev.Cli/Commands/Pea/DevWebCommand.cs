using System.Diagnostics;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal static class DevWebCommand {
    public static async Task<int> RunAsync(IReadOnlyList<string> args, string? repoRootOverride, CancellationToken cancellationToken) {
        if (args.Count == 0 || args[0] is "--help" or "-h") {
            Console.WriteLine("Usage: pe-dev web pea [web options]");
            Console.WriteLine("Runs the source-linked web dev supervisor with fixed local ports and takeover.");
            return args.Count == 0 ? 10 : 0;
        }

        var agent = args[0].ToLowerInvariant();
        if (agent is not "pea") {
            Console.Error.WriteLine("Expected `pea` after `pe-dev web`.");
            return 10;
        }

        string repoRoot;
        try {
            repoRoot = RepoRootResolver.Resolve(repoRootOverride);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var peToolsDirectory = Path.Combine(repoRoot, "source", "pe-tools");
        var devWebMain = Path.Combine(peToolsDirectory, "tools", "dev-web", "src", "main.ts");
        if (!File.Exists(devWebMain)) {
            Console.Error.WriteLine($"Could not locate source-linked web dev helper at '{devWebMain}'.");
            return 10;
        }

        var startInfo = new ProcessStartInfo {
            FileName = "pnpm",
            WorkingDirectory = peToolsDirectory,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.ArgumentList.Add("--dir");
        startInfo.ArgumentList.Add(peToolsDirectory);
        startInfo.ArgumentList.Add("exec");
        startInfo.ArgumentList.Add("node");
        startInfo.ArgumentList.Add("--import");
        startInfo.ArgumentList.Add("jiti/register");
        startInfo.ArgumentList.Add(devWebMain);
        startInfo.ArgumentList.Add(agent);
        startInfo.ArgumentList.Add("web");
        foreach (var argument in args.Skip(1))
            startInfo.ArgumentList.Add(argument);

        return await ForegroundProcessRunner.RunAsync(startInfo, cancellationToken);
    }
}
