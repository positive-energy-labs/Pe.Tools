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

        if (positionals.Count >= 2 && string.Equals(positionals[0], "env", StringComparison.OrdinalIgnoreCase)) {
            var commandKind = positionals[1].ToLowerInvariant() switch {
                "status" => DevCommandKind.EnvStatus,
                "logs" => DevCommandKind.EnvLogs,
                _ => DevCommandKind.Unknown
            };
            return commandKind == DevCommandKind.Unknown
                ? DevCliParseResult.Failure($"Unknown env command '{positionals[1]}'.", true)
                : DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, commandKind, positionals.Skip(2).ToArray()));
        }

        if (positionals.Count >= 2 && string.Equals(positionals[0], "revit", StringComparison.OrdinalIgnoreCase)) {
            var commandKind = positionals[1].ToLowerInvariant() switch {
                "session" => DevCommandKind.RevitSession,
                "sync-runtime" => DevCommandKind.RevitSyncRuntime,
                "test" when positionals.Count >= 3 && string.Equals(positionals[2], "fresh", StringComparison.OrdinalIgnoreCase) => DevCommandKind.RevitTestFresh,
                _ => DevCommandKind.Unknown
            };
            if (commandKind == DevCommandKind.Unknown)
                return DevCliParseResult.Failure($"Unknown revit command '{positionals[1]}'.", true);
            var skip = commandKind == DevCommandKind.RevitTestFresh ? 3 : 2;
            return DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, commandKind, positionals.Skip(skip).ToArray()));
        }

        if (positionals.Count >= 2 && string.Equals(positionals[0], "pea", StringComparison.OrdinalIgnoreCase)) {
            var commandKind = positionals[1].ToLowerInvariant() switch {
                "install-dev" => DevCommandKind.PeaInstallDev,
                _ => DevCommandKind.Unknown
            };
            return commandKind == DevCommandKind.Unknown
                ? DevCliParseResult.Failure($"Unknown pea command '{positionals[1]}'.", true)
                : DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, commandKind, positionals.Skip(2).ToArray()));
        }

        if (positionals.Count >= 1 && string.Equals(positionals[0], "automation", StringComparison.OrdinalIgnoreCase))
            return DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Automation, positionals.Skip(1).ToArray()));

        if (positionals.Count >= 1 && string.Equals(positionals[0], "codegen", StringComparison.OrdinalIgnoreCase))
            return DevCliParseResult.SuccessResult(new DevCliOptions(repoRoot, DevCommandKind.Codegen, positionals.Skip(1).ToArray()));

        return DevCliParseResult.Failure("Expected an `env`, `revit`, `pea`, `automation`, or `codegen` command.", true);
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
