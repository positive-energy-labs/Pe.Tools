namespace Pe.Dev.RevitAutomation;

public enum RevitHotReloadResultKind {
    NoSession,
    Triggered,
    Failed
}

public sealed record RevitHotReloadResult(
    RevitHotReloadResultKind Kind,
    string Message,
    IReadOnlyList<string> DirtyFiles,
    RevitProcessSessionIdentity? Session = null
);
