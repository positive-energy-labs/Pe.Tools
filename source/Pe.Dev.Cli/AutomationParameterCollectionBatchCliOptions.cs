namespace Pe.Dev.Cli;

internal sealed record AutomationParameterCollectionBatchCliOptions(
    string ManifestPath,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation collect-parameters-batch --manifest <path> [--json]
                                     """;

    public static AutomationParameterCollectionBatchCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "collect-parameters-batch", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `collect-parameters-batch` after `pe-dev revit automation`.");

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
                throw new ArgumentException($"Unknown automation parameter batch argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(manifestPath))
            throw new ArgumentException("Missing required argument `--manifest`.");

        return new AutomationParameterCollectionBatchCliOptions(manifestPath, json);
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
