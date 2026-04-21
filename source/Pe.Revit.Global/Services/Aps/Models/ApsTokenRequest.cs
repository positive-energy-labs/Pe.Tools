namespace Pe.Revit.Global.Services.Aps.Models;

public sealed record ApsTokenRequest {
    public ApsAuthFlowKind FlowKind { get; init; } = ApsAuthFlowKind.ThreeLeggedConfidential;
    public ApsScopeProfile ScopeProfile { get; init; } = ApsScopeProfile.ParameterService;
    public IReadOnlyList<string>? ExplicitScopes { get; init; }

    public IReadOnlyList<string> ResolveScopes() =>
        this.ExplicitScopes is { Count: > 0 }
            ? NormalizeScopes(this.ExplicitScopes)
            : ApsScopeProfiles.Resolve(this.ScopeProfile);

    public static ApsTokenRequest ForParameterService(ApsAuthFlowKind flowKind = ApsAuthFlowKind.ThreeLeggedConfidential) =>
        new() { FlowKind = flowKind, ScopeProfile = ApsScopeProfile.ParameterService };

    public static ApsTokenRequest ForAutomationManagement() =>
        new() { FlowKind = ApsAuthFlowKind.TwoLegged, ScopeProfile = ApsScopeProfile.AutomationManagement };

    public static ApsTokenRequest ForAutomationUserContext() =>
        new() {
            FlowKind = ApsAuthFlowKind.ThreeLeggedConfidential,
            ScopeProfile = ApsScopeProfile.AutomationUserContext
        };

    public static IReadOnlyList<string> NormalizeScopes(IEnumerable<string> scopes) =>
        scopes
            .Where(scope => !string.IsNullOrWhiteSpace(scope))
            .Select(scope => scope.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(scope => scope, StringComparer.OrdinalIgnoreCase)
            .ToArray();
}

internal static class ApsScopeProfiles {
    private static readonly IReadOnlyList<string> ParameterServiceScopes = ApsTokenRequest.NormalizeScopes([
        "account:read",
        "data:create",
        "data:write",
        "data:read",
        "bucket:read"
    ]);

    private static readonly IReadOnlyList<string> AutomationManagementScopes = ApsTokenRequest.NormalizeScopes([
        "code:all"
    ]);

    public static IReadOnlyList<string> Resolve(ApsScopeProfile scopeProfile) =>
        scopeProfile switch {
            ApsScopeProfile.ParameterService => ParameterServiceScopes,
            ApsScopeProfile.AutomationManagement => AutomationManagementScopes,
            ApsScopeProfile.AutomationUserContext => AutomationManagementScopes,
            _ => throw new ArgumentOutOfRangeException(nameof(scopeProfile), scopeProfile, null)
        };
}

// PE_HOT_RELOAD_NUDGE
