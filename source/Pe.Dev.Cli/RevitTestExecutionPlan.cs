namespace Pe.Dev.Cli;

internal enum RevitTestLaunchMode {
    LaunchFreshOwnedSession
}

internal sealed record RevitTestExecutionPlan(
    string Configuration,
    int RevitYear,
    string? Filter,
    bool NoBuild,
    bool AllowDeployedAddin,
    RevitTestOwnedSessionState? OwnedSession,
    string Reason
);
