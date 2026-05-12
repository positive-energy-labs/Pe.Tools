namespace Pe.Dev.Cli;

internal static class RootCommandRunner {
    public static Task<int> RunAsync(DevCliOptions options, CancellationToken cancellationToken) =>
        options.CommandKind switch {
            DevCommandKind.EnvLogs => Task.FromResult(EnvCommandRunner.RunLogs(options.CommandArguments)),
            DevCommandKind.EnvStatus => Task.FromResult(EnvStatusCommand.Run(options.CommandArguments)),
            DevCommandKind.RevitSession => Task.FromResult(RevitCommandRunner.RunSessionCommand(options.CommandArguments)),
            DevCommandKind.RevitSyncRuntime => RevitCommandRunner.RunSyncRuntimeCommandAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            DevCommandKind.RevitTestFresh => RevitCommandRunner.RunFreshTestCommandAsync(options.RepoRoot, options.CommandArguments, cancellationToken),
            DevCommandKind.PeaInstallDev => PeaInstallDevCommand.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Automation => AutomationCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.Codegen => CodegenCommandRunner.RunAsync(options.CommandArguments, options.RepoRoot, cancellationToken),
            DevCommandKind.InternalApproveWorker => RevitCommandRunner.RunApproveWorkerCommandAsync(options.CommandArguments, cancellationToken),
            _ => Task.FromResult(10)
        };
}
