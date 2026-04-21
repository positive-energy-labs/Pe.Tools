using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal sealed record AutomationListProjectsCliOptions(
    string HubId,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation list-projects --hub-id <id> [--json]
                                     """;

    public static AutomationListProjectsCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "list-projects", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `list-projects` after `pe-dev revit automation`.");

        string? hubId = null;
        var json = false;
        for (var i = 1; i < args.Count; i++) {
            switch (args[i]) {
            case "--hub-id":
                hubId = RequireValue(args, ref i, args[i]);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation projects argument '{args[i]}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(hubId))
            throw new ArgumentException("Missing required argument `--hub-id`.");

        return new AutomationListProjectsCliOptions(hubId, json);
    }

    public AutomationListProjectsOptions ToOptions() => new(this.HubId);

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
