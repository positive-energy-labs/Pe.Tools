namespace Pe.Shared.ApsAuth;

public sealed record ApsTokenRequest {
    public ApsAuthFlowKind FlowKind { get; init; } = ApsAuthFlowKind.ThreeLeggedConfidential;
    public ApsScopeProfile ScopeProfile { get; init; } = ApsScopeProfile.ParameterService;
    public IReadOnlyList<string>? ExplicitScopes { get; init; }

    public IReadOnlyList<string> ResolveScopes() =>
        this.ExplicitScopes is { Count: > 0 }
            ? NormalizeScopes(this.ExplicitScopes)
            : ApsScopeProfiles.Resolve(this.ScopeProfile);

    public static ApsTokenRequest ForParameterService(ApsAuthFlowKind flowKind =
        ApsAuthFlowKind.ThreeLeggedConfidential) =>
        new() { FlowKind = flowKind, ScopeProfile = ApsScopeProfile.ParameterService };

    public static ApsTokenRequest ForAutomationManagement() =>
        new() { FlowKind = ApsAuthFlowKind.TwoLegged, ScopeProfile = ApsScopeProfile.AutomationManagement };

    public static ApsTokenRequest ForAutomationUserContext() =>
        new() {
            FlowKind = ApsAuthFlowKind.ThreeLeggedConfidential, ScopeProfile = ApsScopeProfile.AutomationUserContext
        };

    public static ApsTokenRequest ForAutomationArtifactStorage() =>
        new() { FlowKind = ApsAuthFlowKind.TwoLegged, ScopeProfile = ApsScopeProfile.AutomationArtifactStorage };

    public static IReadOnlyList<string> NormalizeScopes(IEnumerable<string> scopes) =>
        scopes
            .Where(scope => !string.IsNullOrWhiteSpace(scope))
            .Select(scope => scope.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(scope => scope, StringComparer.OrdinalIgnoreCase)
            .ToArray();
}

internal static class ApsScopeProfiles {
    // Keep delegated 3-legged auth on one shared scope set so host, CLI, and addin
    // can reuse the same persisted refresh token instead of prompting per surface.
    private static readonly IReadOnlyList<string> SharedDelegatedUserScopes = ApsTokenRequest.NormalizeScopes([
        "account:read",
        "bucket:read",
        "code:all",
        "data:create",
        "data:read",
        "data:write"
    ]);

    private static readonly IReadOnlyList<string> AutomationManagementScopes = ApsTokenRequest.NormalizeScopes(["code:all"]);
    private static readonly IReadOnlyList<string> AutomationArtifactStorageScopes = ApsTokenRequest.NormalizeScopes([
        "bucket:create",
        "bucket:read",
        "data:read",
        "data:write"
    ]);

    public static IReadOnlyList<string> Resolve(ApsScopeProfile scopeProfile) =>
        scopeProfile switch {
            ApsScopeProfile.ParameterService => SharedDelegatedUserScopes,
            ApsScopeProfile.AutomationManagement => AutomationManagementScopes,
            ApsScopeProfile.AutomationUserContext => SharedDelegatedUserScopes,
            ApsScopeProfile.AutomationArtifactStorage => AutomationArtifactStorageScopes,
            _ => throw new ArgumentOutOfRangeException(nameof(scopeProfile), scopeProfile, null)
        };
}

// PE_HOT_RELOAD_NUDGE
