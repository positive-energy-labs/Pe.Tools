using Pe.Shared.ApsAuth;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.Operations;

public static class GetApsAuthStatusOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsPersistedTokenStatus>(
            "aps.auth.status",
            HostHttpVerb.Post,
            "/api/aps/auth/status",
            HostExecutionMode.Local,
            "Get APS Auth Status",
            HostOperationAgentMetadata.Create(
                "aps",
                "Read persisted Autodesk Platform Services authentication status.",
                new[] { "aps", "auth", "status", "token" }
            )
        );
}

public static class LoginApsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsPersistedTokenStatus>(
            "aps.auth.login",
            HostHttpVerb.Post,
            "/api/aps/auth/login",
            HostExecutionMode.Local,
            "Login APS",
            HostOperationAgentMetadata.Create(
                "aps",
                "Start or complete Autodesk Platform Services authentication.",
                new[] { "aps", "auth", "login", "token" },
                HostOperationIntent.Mutate
            )
        );
}

public static class LogoutApsOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<NoRequest, ApsLogoutResult>(
            "aps.auth.logout",
            HostHttpVerb.Post,
            "/api/aps/auth/logout",
            HostExecutionMode.Local,
            "Logout APS",
            HostOperationAgentMetadata.Create(
                "aps",
                "Clear persisted Autodesk Platform Services authentication state.",
                new[] { "aps", "auth", "logout", "token" },
                HostOperationIntent.Mutate
            )
        );
}

public static class AcquireApsAccessTokenOperationContract {
    public static readonly HostOperationDefinition Definition =
        HostOperationDefinition.Create<ApsTokenRequest, ApsTokenResult>(
            "aps.auth.token",
            HostHttpVerb.Post,
            "/api/aps/auth/token",
            HostExecutionMode.Local,
            "Acquire APS Access Token",
            HostOperationAgentMetadata.Create(
                "aps",
                "Acquire an Autodesk Platform Services access token for authenticated operations.",
                new[] { "aps", "auth", "access-token", "token" }
            )
        );
}

[ExportTsInterface]
public sealed record ApsLogoutResult(bool LoggedOut);
