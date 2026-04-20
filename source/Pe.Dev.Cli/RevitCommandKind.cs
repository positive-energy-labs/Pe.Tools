namespace Pe.Dev.Cli;

internal enum RevitCommandKind {
    Unknown,
    HotReload,
    ApproveAppAddin,
    ApproveTestAddin,
    Logs,
    AppPostBuild,
    TestsPostBuild
}