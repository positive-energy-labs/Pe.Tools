namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev revit automation auth <login|status|logout> ...
                                        pe-dev revit automation browse <status|hubs|use-hub|projects|use-project|pwd|ls|cd|up|models> ...
                                        pe-dev revit automation manifest <create|show|list|add|remove|set-request|validate> ...
                                        pe-dev revit automation submit schedules --manifest <path> [--receipt <path>] [--refresh] [--json]
                                        pe-dev revit automation inspect <receipt|workitem> ...
                                        pe-dev revit automation workitem-status --workitem-id <id> [--include-report <true|false>] [--json]
                                        pe-dev revit automation cache <status|clear> ...
                                        pe-dev revit session [--json]
                                        pe-dev revit logs <host|app|all> [--tail <count>]
                                        pe-dev revit sync-runtime
                                        pe-dev revit approve [--revit-year <year>] [--timeout-seconds <seconds>] [--skip-if-session-exists]
                                        pe-dev revit hot-reload
                                        pe-dev revit test [--filter <expr>] [--no-build] [--configuration <config> | --revit-year <year>] [--allow-deployed-addin]
                                        pe-dev revit script new <script-name-or-workspace-path>
                                        pe-dev revit script <workspace-relative-script.cs>
                                        pe-dev revit script --workspace <key> --path <workspace-relative-script.cs>
                                        pe-dev revit script --stdin --name <fileName>

                                      Global options:
                                        --repo-root <path>   Override repo root discovery.
                                        --help, -h           Show this help text.
                                      """;

    public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken) {
        DevCliParseResult parseResult;
        try {
            parseResult = DevCliOptions.Parse(args);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            Console.Error.WriteLine(UsageText);
            return 10;
        }

        if (!parseResult.Success || parseResult.Options is null) {
            if (!string.IsNullOrWhiteSpace(parseResult.ErrorMessage)) Console.Error.WriteLine(parseResult.ErrorMessage);

            if (parseResult.ShowUsage) Console.Error.WriteLine(UsageText);

            return parseResult.ShowUsage && string.IsNullOrWhiteSpace(parseResult.ErrorMessage) ? 0 : 10;
        }

        return await RevitCommandRunner.RunAsync(parseResult.Options, cancellationToken);
    }
}
