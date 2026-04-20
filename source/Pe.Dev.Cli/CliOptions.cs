namespace Pe.Dev.Cli;

internal sealed record CliOptions(
    string? RepoRoot,
    RevitCommandKind CommandKind,
    IReadOnlyList<string> ForwardedArguments
)
{
    public static CliParseResult Parse(IReadOnlyList<string> args)
    {
        string? repoRoot = null;
        var positionals = new List<string>();

        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            switch (arg)
            {
                case "--help":
                case "-h":
                    return CliParseResult.Usage();
                case "--repo-root":
                    repoRoot = RequireValue(args, ref i, arg);
                    break;
                default:
                    positionals.Add(arg);
                    break;
            }
        }

        if (positionals.Count < 2 || !string.Equals(positionals[0], "revit", StringComparison.OrdinalIgnoreCase))
        {
            return CliParseResult.Failure("Expected a `revit` command.", showUsage: true);
        }

        var commandKind = positionals[1].ToLowerInvariant() switch
        {
            "hot-reload" or "prepare-hot-reload" => RevitCommandKind.HotReload,
            "approve-app-addin" => RevitCommandKind.ApproveAppAddin,
            "approve-test-addin" => RevitCommandKind.ApproveTestAddin,
            "logs" => RevitCommandKind.Logs,
            "app-post-build" => RevitCommandKind.AppPostBuild,
            "tests-post-build" => RevitCommandKind.TestsPostBuild,
            _ => RevitCommandKind.Unknown
        };

        if (commandKind == RevitCommandKind.Unknown)
        {
            return CliParseResult.Failure($"Unknown command '{positionals[1]}'.", showUsage: true);
        }

        return CliParseResult.SuccessResult(
            new CliOptions(
                repoRoot,
                commandKind,
                positionals.Skip(2).ToArray()
            )
        );
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName)
    {
        if (index + 1 >= args.Count)
        {
            throw new ArgumentException($"Missing value for {optionName}.");
        }

        index++;
        return args[index];
    }
}

internal readonly record struct CliParseResult(
    bool Success,
    CliOptions? Options,
    string? ErrorMessage,
    bool ShowUsage
)
{
    public static CliParseResult SuccessResult(CliOptions options) => new(true, options, null, false);
    public static CliParseResult Failure(string errorMessage, bool showUsage) => new(false, null, errorMessage, showUsage);
    public static CliParseResult Usage() => new(false, null, null, true);
}
