namespace Pe.Dev.Cli;

internal static class CodegenCommandRunner {
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
        if (verb is not ("check" or "sync")) {
            WriteUsage();
            return 10;
        }

        string target;
        try {
            target = ReadTarget(args.Skip(1).ToArray());
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        var check = verb == "check";
        var targets = target == "all" ? ["build", "product", "host-types", "host-client"] : new[] { target };
        foreach (var currentTarget in targets) {
            var exitCode = currentTarget switch {
                "build" => await BuildGeneratedProjection.RunAsync(check, repoRootOverride, cancellationToken),
                "product" => await ProductTypeScriptProjection.RunAsync(check, repoRootOverride, cancellationToken),
                "host-types" => await HostTypeGenerationProjection.RunAsync(check, repoRootOverride, cancellationToken),
                "host-client" => await HostTypeScriptClientProjection.RunAsync(check ? ["--check"] : [], repoRootOverride, cancellationToken),
                _ => 10
            };
            if (exitCode != 0)
                return exitCode;
        }

        return 0;
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

        return target is "all" or "build" or "product" or "host-types" or "host-client"
            ? target
            : throw new ArgumentException($"Unknown codegen target '{target}'. Expected all, build, product, host-types, or host-client.");
    }

    private static void WriteUsage() => Console.Error.WriteLine(
        """
        Usage:
          pe-dev codegen check [--target all|build|product|host-types|host-client]
          pe-dev codegen sync  [--target all|build|product|host-types|host-client]
        """
    );
}
