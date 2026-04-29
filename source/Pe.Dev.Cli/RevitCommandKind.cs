namespace Pe.Dev.Cli;

internal enum RevitCommandKind {
    Unknown,
    Approve,
    Automation,
    HotReload,
    Logs,
    Session,
    SyncRuntime,
    Test,
    Script,
    InternalApproveWorker
}
