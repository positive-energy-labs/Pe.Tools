namespace Pe.Dev.Cli;

internal enum DevCommandKind {
    Unknown,
    Test,
    SelfTest,
    PeaInstallDev,
    PeaLinkDev,
    Automation,
    Codegen,
    InternalApproveWorker
}
