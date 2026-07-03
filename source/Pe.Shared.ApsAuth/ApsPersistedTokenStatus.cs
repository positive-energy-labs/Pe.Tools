using Pe.Shared.Codegen;

namespace Pe.Shared.ApsAuth;

[ExportTsSchema]
public sealed record ApsPersistedTokenStatus(
    bool Exists,
    DateTime? ExpiresAtUtc,
    bool HasRefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);

