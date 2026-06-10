using System.Diagnostics;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli.Codegen;

internal static class CodegenCommandRunner {
    private static readonly IReadOnlyList<string> AllTargets = ["build", "product", "host-types", "host-contracts"];

    public static async Task<int> RunAsync(
        IReadOnlyList<string> args,
        string? repoRootOverride,
        CancellationToken cancellationToken
    ) {
        if (args.Count == 0 || args.Contains("--help", StringComparer.OrdinalIgnoreCase) || args.Contains("-h", StringComparer.OrdinalIgnoreCase)) {
            WriteUsage();
            return args.Count == 0 ? 10 : 0;
        }

        var verb = args[0].ToLowerInvariant();
        if (verb == "check") {
            Console.Error.WriteLine("`pe-dev codegen check` has been removed. Run `pe-dev codegen sync` instead; sync rewrites generated files and formats @pe-tools/host-generated.");
            return 10;
        }

        if (verb != "sync") {
            WriteUsage();
            return 10;
        }

        string target;
        CodegenPaths paths;
        try {
            target = ReadTarget(args.Skip(1).ToArray());
            paths = new CodegenPaths(RepoRootResolver.Resolve(repoRootOverride));
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var targets = target == "all" ? AllTargets : [target];
        foreach (var currentTarget in targets) {
            var exitCode = currentTarget switch {
                "build" => await BuildGeneratedProjection.RunAsync(false, paths, cancellationToken),
                "product" => await ProductTypeScriptProjection.RunAsync(false, paths, cancellationToken),
                "host-types" => await HostTypeGenerationProjection.RunAsync(false, paths, cancellationToken),
                "host-contracts" => await HostTypeScriptClientProjection.RunAsync(false, paths, cancellationToken),
                _ => 10
            };
            if (exitCode != 0)
                return exitCode;
        }

        return ShouldFormatHostGenerated(targets)
            ? await FormatHostGeneratedAsync(paths, cancellationToken)
            : 0;
    }

    private static bool ShouldFormatHostGenerated(IEnumerable<string> targets) => targets.Any(target => target is "product" or "host-types" or "host-contracts");

    private static async Task<int> FormatHostGeneratedAsync(CodegenPaths paths, CancellationToken cancellationToken) {
        Console.WriteLine("Formatting @pe-tools/host-generated...");
        var startInfo = OperatingSystem.IsWindows()
            ? new ProcessStartInfo {
                FileName = "cmd.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = paths.PeToolsDirectory,
                ArgumentList = { "/c", "vp", "check", "--fix", "packages/host-generated" }
            }
            : new ProcessStartInfo {
                FileName = "vp",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = paths.PeToolsDirectory,
                ArgumentList = { "check", "--fix", "packages/host-generated" }
            };
        return await ForegroundProcessRunner.RunAsync(startInfo, cancellationToken);
    }

    private static string ReadTarget(IReadOnlyList<string> args) {
        var target = "all";
        for (var i = 0; i < args.Count; i++) {
            switch (args[i]) {
            case "--target":
                if (i + 1 >= args.Count)
                    throw new ArgumentException("Missing value for --target.");
                target = args[++i].ToLowerInvariant();
                break;
            default:
                throw new ArgumentException($"Unknown codegen option '{args[i]}'.");
            }
        }

        return target == "all" || AllTargets.Contains(target, StringComparer.Ordinal)
            ? target
            : throw new ArgumentException($"Unknown codegen target '{target}'. Expected all, {string.Join(", ", AllTargets)}.");
    }

    private static void WriteUsage() => Console.Error.WriteLine(
        """
        Usage:
          pe-dev codegen sync [--target all|build|product|host-types|host-contracts]
        """
    );
}
