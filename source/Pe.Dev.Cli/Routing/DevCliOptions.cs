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

        if (positionals.Count == 0)
            return DevCliParseResult.Failure("Expected a `self-test`, `web`, or `automation` command.", true);

        var first = positionals[0].ToLowerInvariant();
        return first switch {
            "bootstrap-path" => DevCliParseResult.Failure("`pe-dev bootstrap-path` has been removed: it rewrote the whole user PATH as REG_SZ (destroying REG_EXPAND_SZ). The SDK owns PATH now — run `pe-revit path ensure` once (registers the product shims dir), then `pe-revit dev link` from this checkout (routes pea/pe-dev shims to source).", true),
            "self-test" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.SelfTest, positionals.Skip(1).ToArray())),
            "pea" when positionals.Count == 1 => DevCliParseResult.Usage(),
            "pea" => ParsePea(repoRoot, positionals),
            "web" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Web, positionals.Skip(1).ToArray())),
            "automation" => DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Automation, positionals.Skip(1).ToArray())),
            "codegen" => DevCliParseResult.Failure("`pe-dev codegen` has been removed. Ops/types come from the live session now: GET /ops on the running host, `pnpm --filter @pe/host-contracts codegen` for checked-in types.", true),
            "doctor" or "status" or "sync" or "env" or "revit" or "verify" => DevCliParseResult.Failure($"`pe-dev {positionals[0]}` has been removed. Use SDK `pe-revit live`/`pe-revit test` for live-loop mechanics; use the pea MCP tools (pe_status, pe_logs) when Pea status/logs or product probes are needed.", true),
            "test" => DevCliParseResult.Failure("`pe-dev test` has been removed. Use SDK `pe-revit test fresh|attached` or the SDK MCP `test_fresh`/`test_attached` tools.", true),
            _ => DevCliParseResult.Failure($"Unknown command '{positionals[0]}'.", true)
        };
    }

    private static DevCliParseResult ParsePea(string? repoRoot, IReadOnlyList<string> positionals) {
        var subcommand = positionals[1].ToLowerInvariant();
        if (subcommand is "--help" or "-h") return DevCliParseResult.Usage();

        if (subcommand == "install-dev")
            return DevCliParseResult.Failure(
                "`pe-dev pea install-dev` has been removed because it mutates the installed pea payload selection. Use `pe-revit dev link` for source-linked dev work and `pea --installed ...` for installed-lane validation.",
                true
            );

        if (subcommand == "link-dev")
            return DevCliParseResult.Failure(
                "`pe-dev pea link-dev` has been removed (it kept a second shim generator and prepended the user PATH). Use the SDK verbs: `pe-revit path ensure` once, then `pe-revit dev link` from this checkout; `pe-revit dev status` shows each shim's lane.",
                true
            );

        return DevCliParseResult.Failure($"Unknown pea command '{positionals[1]}'.", true);
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
