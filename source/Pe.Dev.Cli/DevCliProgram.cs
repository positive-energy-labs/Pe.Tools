namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev revit hot-reload [prepare-hot-reload args...]
                                        pe-dev revit approve-app-addin [app-auto-approve args...]
                                        pe-dev revit approve-test-addin [test-auto-approve args...]
                                        pe-dev revit logs <host|app|all> [--tail <count>] [--path]
                                        pe-dev revit app-post-build [--script-directory <path>] [--timeout-seconds <seconds>]
                                        pe-dev revit tests-post-build [--script-directory <path>] [--revit-year <year>]

                                      Global options:
                                        --repo-root <path>   Override repo root discovery.
                                        --help, -h           Show this help text.

                                      Notes:
                                        - `hot-reload`, `approve-app-addin`, and `approve-test-addin` forward
                                          their remaining arguments directly to the underlying PowerShell script.
                                        - `logs` reads the bounded host/app log files under `Documents\\Pe.App\\Global`.
                                        - `app-post-build` and `tests-post-build` provide stable CLI entrypoints
                                          for the current build hooks.
                                      """;

    public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken) {
        CliParseResult parseResult;
        try {
            parseResult = CliOptions.Parse(args);
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

        RepoLayout repoLayout;
        try {
            repoLayout = RepoLayout.Create(parseResult.Options.RepoRoot);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        return await RevitCommandRunner.RunAsync(parseResult.Options, repoLayout, cancellationToken);
    }
}