using Pe.Shared.ApsAuth;

namespace Pe.Shared.HostContracts.Operations;

public static class GetApsAuthStatusOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsPersistedTokenStatus>(
            "aps.auth.status",
            HostHttpVerb.Post,
            "/api/aps/auth/status",
            HostExecutionMode.Local,
            "Get APS Auth Status"
        );
}

public static class LoginApsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsPersistedTokenStatus>(
            "aps.auth.login",
            HostHttpVerb.Post,
            "/api/aps/auth/login",
            HostExecutionMode.Local,
            "Login APS"
        );
}

public static class LogoutApsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, ApsLogoutResult>(
            "aps.auth.logout",
            HostHttpVerb.Post,
            "/api/aps/auth/logout",
            HostExecutionMode.Local,
            "Logout APS"
        );
}

public static class AcquireApsAccessTokenOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsTokenResult>(
            "aps.auth.token",
            HostHttpVerb.Post,
            "/api/aps/auth/token",
            HostExecutionMode.Local,
            "Acquire APS Access Token"
        );
}

public sealed record ApsLogoutResult(bool LoggedOut);
