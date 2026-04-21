namespace Pe.Dev.Cli;

internal sealed record AutomationScheduleCollectionBatchCliOptions(
    string ManifestPath,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation collect-schedules-batch --manifest <path> [--json]
                                     """;

    public static AutomationScheduleCollectionBatchCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "collect-schedules-batch", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `collect-schedules-batch` after `pe-dev revit automation`.");

        string? manifestPath = null;
        var json = false;

        for (var i = 1; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--manifest":
                manifestPath = RequireValue(args, ref i, arg);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation schedule batch argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(manifestPath))
            throw new ArgumentException("Missing required argument `--manifest`.");

        return new AutomationScheduleCollectionBatchCliOptions(manifestPath, json);
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
