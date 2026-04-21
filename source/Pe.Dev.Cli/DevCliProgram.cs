namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev revit approve [--revit-year <year>] [--timeout-seconds <seconds>] [--skip-if-session-exists]
                                        pe-dev revit automation list-hubs [--json]
                                        pe-dev revit automation list-projects --hub-id <id> [--json]
                                        pe-dev revit automation list-contents --hub-id <id> --project-id <id> [--folder-id <id> | --folder-path <path>] [--json]
                                        pe-dev revit automation discover-models --hub-id <id> --project-id <id> [--folder-id <id> | --folder-path <path>] [--name-contains <text>] [--recurse <true|false>] [--exclude-path-glob <pattern>]... [--region <US|EMEA>] [--out-manifest <path>] [--engine <engine>] [--timeout-seconds <seconds>] [--max-concurrency <count>] [--debug <true|false>] [--mask <true|false>] [--family-name <name>]... [--category-name <name>]... [--placement-scope <AllLoaded|PlacedOnly|UnplacedOnly>] [--json]
                                        pe-dev revit automation collect-parameters --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] [--engine <engine>] [--timeout-seconds <seconds>] [--debug <true|false>] [--mask <true|false>] [--family-name <name>]... [--category-name <name>]... [--placement-scope <AllLoaded|PlacedOnly|UnplacedOnly>] [--json]
                                        pe-dev revit automation collect-parameters-batch --manifest <path> [--json]
                                        pe-dev revit automation probe-access --region <US|EMEA> --project-guid <guid> --model-guid <guid> [--expected-title <title>] [--engine <engine>] [--timeout-seconds <seconds>] [--debug <true|false>] [--mask <true|false>] [--json]
                                        pe-dev revit automation workitem-status --workitem-id <id> [--include-report <true|false>] [--mask <true|false>] [--json]
                                        pe-dev revit hot-reload
                                        pe-dev revit logs <host|app|all> [--tail <count>]
                                        pe-dev revit session
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
