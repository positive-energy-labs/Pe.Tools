namespace Pe.Dev.Cli;

internal sealed record DevCliOptions(
    string? RepoRoot,
    DevCommandKind CommandKind,
    IReadOnlyList<string> CommandArguments
) {
    public static DevCliParseResult Parse(IReadOnlyList<string> args) {
        string? repoRoot = null;
        var positionals = new List<string>();

        for (var i = 0; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--help":
            case "-h":
                if (positionals.Count == 0)
                    return DevCliParseResult.Usage();
                positionals.Add(arg);
                break;
            case "--repo-root":
                if (positionals.Count == 0) {
                    repoRoot = RequireValue(args, ref i, arg);
                    break;
                }

                positionals.Add(arg);
                break;
            default:
                positionals.Add(arg);
                break;
            }
        }

        if (positionals.Count >= 2 && string.Equals(positionals[0], "__internal", StringComparison.OrdinalIgnoreCase)) {
            var commandKind = positionals[1].ToLowerInvariant() switch {
                "approve-worker" => DevCommandKind.InternalApproveWorker,
                _ => DevCommandKind.Unknown
            };
            return commandKind == DevCommandKind.Unknown
                ? DevCliParseResult.Failure($"Unknown internal command '{positionals[1]}'.", true)
                : DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, commandKind, positionals.Skip(2).ToArray()));
        }

        if (positionals.Count == 0)
            return DevCliParseResult.Failure("Expected a `bootstrap-path`, `test`, `self-test`, `pea`, `web`, `automation`, or `codegen` command.", true);

        var first = positionals[0].ToLowerInvariant();
        return first switch {
            "bootstrap-path" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.BootstrapPath, positionals.Skip(1).ToArray())),
            "test" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Test, positionals.Skip(1).ToArray())),
            "self-test" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.SelfTest, positionals.Skip(1).ToArray())),
            "pea" when positionals.Count == 1 => DevCliParseResult.Usage(),
            "pea" => ParsePea(repoRoot, positionals),
            "web" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Web, positionals.Skip(1).ToArray())),
            "automation" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Automation, positionals.Skip(1).ToArray())),
            "codegen" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Codegen, positionals.Skip(1).ToArray())),
            "doctor" or "status" or "sync" or "env" or "revit" or "verify" => DevCliParseResult.Failure($"`pe-dev {positionals[0]}` has been removed. Use the peco `live_loop_context`/`live_rrd_sync` tools for live-loop work, or `pe-dev test` for FreshRevitProcess proof.", true),
            _ => DevCliParseResult.Failure($"Unknown command '{positionals[0]}'.", true)
        };
    }

    private static DevCliParseResult ParsePea(string? repoRoot, IReadOnlyList<string> positionals) {
        var subcommand = positionals[1].ToLowerInvariant();
        if (subcommand is "--help" or "-h") return DevCliParseResult.Usage();

        if (subcommand == "install-dev")
            return DevCliParseResult.Failure(
                "`pe-dev pea install-dev` has been removed because it mutates the installed pea payload selection. Use `pe-dev pea link-dev` for source-linked dev work and `pea --installed ...` for installed-lane validation.",
                true
            );

        var commandKind = subcommand switch {
            "link-dev" => DevCommandKind.PeaLinkDev,
            _ => DevCommandKind.Unknown
        };
        return commandKind == DevCommandKind.Unknown
            ? DevCliParseResult.Failure($"Unknown pea command '{positionals[1]}'.", true)
            : DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, commandKind, positionals.Skip(2).ToArray()));
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count) throw new ArgumentException($"Missing value for {optionName}.");
        index++;
        return args[index];
    }
}

internal readonly record struct DevCliParseResult(
    bool Success,
    DevCliOptions? Options,
    string? ErrorMessage,
    bool ShowUsage
) {
    public static DevCliParseResult SuccessResult(DevCliOptions options) => new(true, options, null, false);
    public static DevCliParseResult Failure(string errorMessage, bool showUsage) => new(false, null, errorMessage, showUsage);
    public static DevCliParseResult Usage() => new(false, null, null, true);
}
