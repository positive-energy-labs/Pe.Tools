namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev doctor [--json] [--revit-year <year> --require-attached-rrd]
                                        pe-dev status [--json]
                                        pe-dev sync [--json]
                                        pe-dev test [--plan|--dry-run] [--filter <vstest-filter>] [--timeout-seconds <seconds>] [--json]
                                        pe-dev self-test [--json]
                                        pe-dev pea install-dev
                                        pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...
                                        pe-dev codegen <check|sync> [--target all|build|host-types|host-client]

                                      Primary workflow:
                                        doctor     Diagnose environment, host, RRD, bridge, and runtime freshness.
                                        status     Print current env/session/runtime state without recommendations.
                                        sync       Trigger Rider/RRD signal-file Reload All from Disk + Apply Changes.
                                        test       Run fresh-owned Revit verification; use --plan for no-launch inspection.

                                      Removed command groups:
                                        env, revit, and verify were intentionally removed from the public surface.

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

        return await RootCommandRunner.RunAsync(parseResult.Options, cancellationToken);
    }
}
