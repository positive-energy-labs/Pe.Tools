namespace Pe.Dev.Cli;

internal static class DevCliProgram {
    internal const string UsageText = """
                                      Usage:
                                        pe-dev env <status|logs> ...
                                        pe-dev revit <session|sync-runtime|test fresh> ...
                                        pe-dev pea <install-dev>
                                        pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...
                                        pe-dev codegen <check|sync> [--target all|build|host-types|host-client]

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
