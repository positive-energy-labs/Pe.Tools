using Pe.Dev.Cli.Codegen;

namespace Pe.Dev.Cli;

internal static class RootCommandRunner {
    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            DevCommandKind.BootstrapPath => Task.FromResult(BootstrapPathCommand.Run(options.CommandArguments, options.RepoRoot)),
            DevCommandKind.SelfTest => Task.FromResult(VerifySelfTestCommand.Run(options.CommandArguments)),
            DevCommandKind.PeaLinkDev => Task.FromResult(PeaLinkDevCommand.Run(options.CommandArguments, options.RepoRoot)),
            DevCommandKind.Web => DevWebCommand.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Automation => AutomationCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Codegen => CodegenCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            _ => Task.FromResult(10)
        };
}
