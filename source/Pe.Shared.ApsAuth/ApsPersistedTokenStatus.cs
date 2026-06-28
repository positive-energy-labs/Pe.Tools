using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.ApsAuth;

[ExportTsInterface]
public sealed record ApsPersistedTokenStatus(
    bool Exists,
    DateTime? ExpiresAtUtc,
    bool HasRefreshToken,
    ApsScopeProfile ScopeProfile,
    ApsAuthFlowKind FlowKind
);

