namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev bootstrap-path
                                        pe-dev test [--plan|--dry-run] [--filter <vstest-filter>] [--timeout-seconds <seconds>] [--json]
                                        pe-dev self-test [--json]
                                        pe-dev pea link-dev
                                        pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...
                                        pe-dev codegen <check|sync> [--target all|build|host-types|host-client]

                                      Primary workflow:
                                        bootstrap-path  Add the running pe-dev build output directory to the user PATH.
                                        test            Run fresh-owned Revit verification; use --plan for no-launch inspection.

                                      Removed command groups:
                                        doctor, status, sync, env, revit, and verify were intentionally removed from the public surface.
                                        Use peco live_loop_context/live_rrd_sync for attached live-loop work.

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
            if (!string.IsNullOrWhiteSpace(parseResult.ErrorMessage)) {
                Console.Error.WriteLine(parseResult.ErrorMessage);
                if (parseResult.ShowUsage) Console.Error.WriteLine(UsageText);
                return 10;
            }

            if (parseResult.ShowUsage) Console.WriteLine(UsageText);
            return 0;
        }

        return await RootCommandRunner.RunAsync(parseResult.Options, cancellationToken);
    }
}
