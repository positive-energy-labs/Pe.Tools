namespace Pe.Dev.Cli;

internal sealed record DevCliOptions(
    string? RepoRoot,
    RevitCommandKind CommandKind,
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
            var internalCommandKind = positionals[1].ToLowerInvariant() switch {
                "approve-worker" => RevitCommandKind.InternalApproveWorker,
                _ => RevitCommandKind.Unknown
            };

            if (internalCommandKind == RevitCommandKind.Unknown)
                return DevCliParseResult.Failure($"Unknown internal command '{positionals[1]}'.", true);

            return DevCliParseResult.SuccessResult(
                new DevCliOptions(
                    repoRoot,
                    internalCommandKind,
                    positionals.Skip(2).ToArray()
                )
            );
        }

        if (positionals.Count < 2 || !string.Equals(positionals[0], "revit", StringComparison.OrdinalIgnoreCase))
            return DevCliParseResult.Failure("Expected a `revit` command.", true);

        var commandKind = positionals[1].ToLowerInvariant() switch {
            "approve" => RevitCommandKind.Approve,
            "automation" => RevitCommandKind.Automation,
            "hot-reload" => RevitCommandKind.HotReload,
            "logs" => RevitCommandKind.Logs,
            "session" => RevitCommandKind.Session,
            "script" => RevitCommandKind.Script,
            _ => RevitCommandKind.Unknown
        };

        if (commandKind == RevitCommandKind.Unknown)
            return DevCliParseResult.Failure($"Unknown command '{positionals[1]}'.", true);

        return DevCliParseResult.SuccessResult(
            new DevCliOptions(
                repoRoot,
                commandKind,
                positionals.Skip(2).ToArray()
            )
        );
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

    public static DevCliParseResult Failure(string errorMessage, bool showUsage) =>
        new(false, null, errorMessage, showUsage);

    public static DevCliParseResult Usage() => new(false, null, null, true);
}
