
namespace Pe.Shared.ApsAuth;

public sealed record ApsPersistedTokenStatus(
    bool Exists,
    DateTime? ExpiresAtUtc,
    bool HasRefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);

