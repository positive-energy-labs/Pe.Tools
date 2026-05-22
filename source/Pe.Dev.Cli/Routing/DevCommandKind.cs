namespace Pe.Dev.Cli;

internal enum DevCommandKind {
    Unknown,
    Doctor,
    Status,
    Sync,
    Test,
    SelfTest,
    PeaInstallDev,
    Automation,
    Codegen,
    InternalApproveWorker
}
