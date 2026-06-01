namespace Pe.Dev.Cli;

internal static class RootCommandRunner {
    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            DevCommandKind.Test => RevitCommandRunner.RunFreshTestCommandAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            DevCommandKind.SelfTest => Task.FromResult(VerifySelfTestCommand.Run(options.CommandArguments)),
            DevCommandKind.PeaInstallDev => PeaInstallDevCommand.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.PeaLinkDev => Task.FromResult(PeaLinkDevCommand.Run(options.CommandArguments, options.RepoRoot)),
            DevCommandKind.Automation => AutomationCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Codegen => CodegenCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.InternalApproveWorker => RevitCommandRunner.RunApproveWorkerCommandAsync(options.CommandArguments, cancellationToken),
            _ => Task.FromResult(10)
        };
}
