using ApsClient = Pe.Aps.Aps;
using Pe.Shared.StorageRuntime;

namespace Pe.Dev.RevitAutomation;

internal static class RevitAutomationApsCredentials {
    public static ApsClient CreateAps() {
        var credentials = new ApsCredentialSource().ReadCredentials();
        return new ApsClient(new ApsClient.StaticAuthTokenProvider(credentials.WebClientId, credentials.WebClientSecret));
    }

    public static string GetConfiguredWebClientId() =>
        new ApsCredentialSource().GetConfiguredWebClientId();
}
