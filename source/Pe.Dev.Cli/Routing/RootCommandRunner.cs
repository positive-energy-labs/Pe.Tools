namespace Pe.Dev.Cli;

internal static class RootCommandRunner {
    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            DevCommandKind.SelfTest => Task.FromResult(VerifySelfTestCommand.Run(options.CommandArguments)),
            DevCommandKind.Web => DevWebCommand.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Automation => AutomationCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            _ => Task.FromResult(10)
        };
}
