namespace Pe.Dev.Cli;

internal enum DevCommandKind {
    Unknown,
    BootstrapPath,
    Test,
    SelfTest,
    PeaLinkDev,
    Web,
    Automation,
    Codegen,
    InternalApproveWorker
}
