namespace Pe.Dev.RevitAutomation;

public enum RevitHotReloadResultKind {
    NoSession,
    NoDirtyFiles,
    Triggered,
    Failed,
    RestartRequiredLikely
}

public sealed record RevitHotReloadResult(
    RevitHotReloadResultKind Kind,
    string Message,
    IReadOnlyList<string> DirtyFiles,
    RevitProcessSessionIdentity? Session = null
);
