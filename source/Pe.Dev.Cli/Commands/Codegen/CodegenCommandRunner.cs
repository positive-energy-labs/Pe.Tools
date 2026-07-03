using System.Diagnostics;
using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli.Codegen;

internal static class CodegenCommandRunner {
    private static readonly IReadOnlyList<string> AllTargets = ["build", "product", "host-contracts"];

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
            Console.Error.WriteLine("`pe-dev codegen check` has been removed. Run `pe-dev codegen sync` instead; sync rewrites generated files and formats @pe/host-contracts.");
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
                "build" => await BuildGeneratedProjection.RunAsync(paths, cancellationToken),
                "product" => await ProductTypeScriptProjection.RunAsync(paths, cancellationToken),
                "host-contracts" => await HostContractsProjection.RunAsync(paths, cancellationToken),
                _ => 10
            };
            if (exitCode != 0)
                return exitCode;
        }

        if (targets.Any(static targetName => targetName is "product" or "host-contracts")) {
            var formatExitCode = await FormatHostContractsAsync(paths, cancellationToken);
            if (formatExitCode != 0)
                return formatExitCode;
        }

        return 0;
    }

    private static Task<int> FormatHostContractsAsync(CodegenPaths paths, CancellationToken cancellationToken) =>
        ForegroundProcessRunner.RunAsync(
            new ProcessStartInfo("vp") {
                WorkingDirectory = paths.PeToolsDirectory,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                ArgumentList = { "check", "--fix", "packages/host-contracts" }
            },
            cancellationToken
        );

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

        if (target != "all" && !AllTargets.Contains(target, StringComparer.Ordinal))
            throw new ArgumentException($"Unknown codegen target '{target}'. Expected all, {string.Join(", ", AllTargets)}.");

        return target;
    }

    private static void WriteUsage() => Console.Error.WriteLine(
        """
        Usage:
          pe-dev codegen sync [--target all|build|product|host-contracts]
        """
    );
}
