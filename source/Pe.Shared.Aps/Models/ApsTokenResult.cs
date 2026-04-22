namespace Pe.Shared.Aps.Models;

public sealed record ApsTokenResult(
    string AccessToken,
    DateTime ExpiresAtUtc,
    string? RefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);

// PE_HOT_RELOAD_NUDGE