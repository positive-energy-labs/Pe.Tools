using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal sealed record AutomationWorkItemCliOptions(
    string WorkItemId,
    bool IncludeReport,
    bool Mask,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation workitem-status --workitem-id <id> [--include-report <true|false>] [--mask <true|false>] [--json]
                                     """;

    public static AutomationWorkItemCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "workitem-status", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `workitem-status` after `pe-dev revit automation`.");

        string? workItemId = null;
        var includeReport = true;
        var mask = true;
        var json = false;

        for (var i = 1; i < args.Count; i++) {
            var arg = args[i];
            switch (arg) {
            case "--workitem-id":
                workItemId = RequireValue(args, ref i, arg);
                break;
            case "--include-report":
                includeReport = ReadBooleanOption(args, ref i, defaultValue: true);
                break;
            case "--mask":
                mask = ReadBooleanOption(args, ref i, defaultValue: true);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation workitem argument '{arg}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(workItemId))
            throw new ArgumentException("Missing required argument `--workitem-id`.");

        return new AutomationWorkItemCliOptions(workItemId, includeReport, mask, json);
    }

    public AutomationWorkItemInspectOptions ToInspectOptions() =>
        new(this.WorkItemId, this.IncludeReport, this.Mask, this.Json);

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }

    private static bool ReadBooleanOption(IReadOnlyList<string> args, ref int index, bool defaultValue) {
        if (index + 1 >= args.Count || args[index + 1].StartsWith("--", StringComparison.Ordinal))
            return defaultValue;

        index++;
        return bool.Parse(args[index]);
    }
}
