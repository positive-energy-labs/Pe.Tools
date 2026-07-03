using Pe.Shared.Codegen;

namespace Pe.Shared.ApsAuth;

[ExportTsSchema]
public sealed record ApsTokenResult(
    string AccessToken,
    DateTime ExpiresAtUtc,
    string? RefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);

// PE_HOT_RELOAD_NUDGE
