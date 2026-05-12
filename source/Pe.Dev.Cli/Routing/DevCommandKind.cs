namespace Pe.Dev.Cli;

internal enum DevCommandKind {
    Unknown,
    EnvLogs,
    EnvStatus,
    RevitSession,
    RevitSyncRuntime,
    RevitTestFresh,
    PeaInstallDev,
    Automation,
    Codegen,
    InternalApproveWorker
}
