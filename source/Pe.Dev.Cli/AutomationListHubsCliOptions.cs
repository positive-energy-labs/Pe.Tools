namespace Pe.Dev.Cli;

internal sealed record AutomationListHubsCliOptions(
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation list-hubs [--json]
                                     """;

    public static AutomationListHubsCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "list-hubs", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `list-hubs` after `pe-dev revit automation`.");

        var json = false;
        for (var i = 1; i < args.Count; i++) {
            switch (args[i]) {
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation hubs argument '{args[i]}'.");
            }
        }

        return new AutomationListHubsCliOptions(json);
    }
}
