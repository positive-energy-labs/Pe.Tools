namespace Pe.Dev.Cli;

internal sealed record RevitFreshTestReport(
    int SchemaVersion,
    string Command,
    string Outcome,
    int ExitCode,
    string? Failure,
    RevitFreshTestPlanSummary? Plan,
    bool PlanOnly,
    string? RuntimeFingerprint,
    int? BuildExitCode,
    int? TestExitCode,
    int? CloseExitCode,
    IReadOnlyList<string> BuildStdoutTail,
    IReadOnlyList<string> BuildStderrTail,
    IReadOnlyList<string> TestStdoutTail,
    IReadOnlyList<string> TestStderrTail
);

internal sealed record RevitFreshTestPlanSummary(
    string Configuration,
    int RevitYear,
    string? Filter,
    bool NoBuild,
    bool AllowDeployedAddin,
    int? TimeoutSeconds,
    bool WillBuild,
    bool WillLaunchFreshRevit,
    bool WillQuarantineDeployedAddin,
    string Reason
);
