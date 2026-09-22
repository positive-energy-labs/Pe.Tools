
namespace Pe.Shared.ApsAuth;

public sealed record ApsTokenResult(
    string AccessToken,
    DateTime ExpiresAtUtc,
    string? RefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);
