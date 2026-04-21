using Pe.Dev.RevitAutomation;

namespace Pe.Dev.Cli;

internal sealed record AutomationListContentsCliOptions(
    string HubId,
    string ProjectId,
    string? FolderId,
    string? FolderPath,
    bool Json
) {
    public const string UsageText = """
                                     Usage:
                                       pe-dev revit automation list-contents --hub-id <id> --project-id <id> [--folder-id <id> | --folder-path <path>] [--json]
                                     """;

    public static AutomationListContentsCliOptions Parse(IReadOnlyList<string> args) {
        if (args.Count == 0 || !string.Equals(args[0], "list-contents", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Expected `list-contents` after `pe-dev revit automation`.");

        string? hubId = null;
        string? projectId = null;
        string? folderId = null;
        string? folderPath = null;
        var json = false;

        for (var i = 1; i < args.Count; i++) {
            switch (args[i]) {
            case "--hub-id":
                hubId = RequireValue(args, ref i, args[i]);
                break;
            case "--project-id":
                projectId = RequireValue(args, ref i, args[i]);
                break;
            case "--folder-id":
                folderId = RequireValue(args, ref i, args[i]);
                break;
            case "--folder-path":
                folderPath = RequireValue(args, ref i, args[i]);
                break;
            case "--json":
                json = true;
                break;
            default:
                throw new ArgumentException($"Unknown automation contents argument '{args[i]}'.");
            }
        }

        if (string.IsNullOrWhiteSpace(hubId))
            throw new ArgumentException("Missing required argument `--hub-id`.");
        if (string.IsNullOrWhiteSpace(projectId))
            throw new ArgumentException("Missing required argument `--project-id`.");
        if (!string.IsNullOrWhiteSpace(folderId) && !string.IsNullOrWhiteSpace(folderPath))
            throw new ArgumentException("Pass either `--folder-id` or `--folder-path`, not both.");

        return new AutomationListContentsCliOptions(hubId, projectId, folderId, folderPath, json);
    }

    public AutomationListContentsOptions ToOptions() => new(this.HubId, this.ProjectId, this.FolderId, this.FolderPath);

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count)
            throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}
