namespace Pe.Dev.Cli;

internal enum RevitCommandKind {
    Unknown,
    Approve,
    Automation,
    HotReload,
    Logs,
    PeaSyncRuntime,
    RuntimeStatus,
    Session,
    SyncRuntime,
    Test,
    SyncPeaHostClient,
    InternalApproveWorker
}
