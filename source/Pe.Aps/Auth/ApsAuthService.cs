using Pe.Shared.ApsAuth;

namespace Pe.Aps.Auth;

public sealed class ApsAuthService(IApsCredentialProvider credentialProvider) {
    private readonly IApsCredentialProvider _credentialProvider = credentialProvider;

    public ApsPersistedTokenStatus GetStatus(ApsTokenRequest request) {
        var aps = this.CreateAps();
        return aps.GetPersistedTokenStatus(request);
    }

    public ApsPersistedTokenStatus Login(
        ApsTokenRequest request,
        Action<string>? log = null
    ) {
        var aps = this.CreateAps();
        log?.Invoke($"Auth: acquiring {request.FlowKind} token for {request.ScopeProfile}");
        _ = aps.GetTokenResult(request);
        return aps.GetPersistedTokenStatus(request);
    }

    public void Logout() {
        var aps = this.CreateAps();
        aps.ClearPersistedTokens();
    }

    public ApsTokenResult AcquireAccessToken(ApsTokenRequest request) =>
        this.CreateAps().GetTokenResult(request);

    private global::Pe.Aps.Aps CreateAps() => new(this._credentialProvider);
}
