using Pe.Shared.ApsAuth;
using Pe.Shared.Product;

namespace Pe.Revit.Global.Services.Aps;

internal static class TsApsAuthClient {
    private static readonly TimeSpan CallTimeout = TimeSpan.FromSeconds(30);

    public static ApsTokenResult AcquireAccessToken(ApsTokenRequest request) =>
        TsHostCallClient.Call<ApsTokenResult>("aps.auth.token", request, CallTimeout);

    public static ApsPersistedTokenStatus Login(ApsTokenRequest request) =>
        TsHostCallClient.Call<ApsPersistedTokenStatus>("aps.auth.login", request, CallTimeout);

    public static ApsPersistedTokenStatus Status(ApsTokenRequest request) =>
        TsHostCallClient.Call<ApsPersistedTokenStatus>("aps.auth.status", request, CallTimeout);
}
