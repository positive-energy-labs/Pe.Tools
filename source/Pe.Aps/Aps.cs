using Pe.Aps.Auth;
using Pe.Shared.ApsAuth;
using Autodesk.SDKManager;
using Pe.Aps.Core;
using Pe.Aps.DataManagement;
using Pe.Aps.DesignAutomation;
using System.Net.Http.Headers;

namespace Pe.Aps;

public sealed class Aps(IApsCredentialProvider authTokenProvider) {
    private const string DeveloperApiBaseUrl = "https://developer.api.autodesk.com/";
    private const string AutomationApiBaseUrl = "https://developer.api.autodesk.com/da/us-east/v3/";

    private static readonly SDKManager SdkManager = SdkManagerBuilder.Create().Build();
    private readonly ApsAuthenticationService _auth = new(authTokenProvider);

    private HttpClient CreateHttpClient(ApsTokenRequest request, string baseUrl = DeveloperApiBaseUrl) => new() {
        BaseAddress = new Uri(baseUrl),
        DefaultRequestHeaders = {
            Accept = { new MediaTypeWithQualityHeaderValue("application/json") },
            Authorization = new AuthenticationHeaderValue("Bearer", this._auth.GetToken(request))
        }
    };

    public ObjectStorageApiClient ObjectStorage(ApsTokenRequest request) =>
        new(SdkManager, () => this._auth.GetToken(request));

    public DataManagementApiClient DataManagement() =>
        new(
            SdkManager,
            () => this._auth.GetToken(ApsTokenRequest.ForParameterService()),
            this.ObjectStorage(ApsTokenRequest.ForParameterService())
        );

    public AutomationApiClient Automation() =>
        new(
            this.CreateHttpClient(ApsTokenRequest.ForAutomationManagement(), AutomationApiBaseUrl),
            authTokenProvider.GetClientId()
        );

    public DesignAutomationService DesignAutomation() => new(this.Automation);

    public ApsCloudModelCatalog CloudModels() => new(this.DataManagement());

    public string GetToken() => this._auth.GetToken();
    public string GetToken(ApsTokenRequest request) => this._auth.GetToken(request);
    public ApsTokenResult GetTokenResult(ApsTokenRequest request) => this._auth.GetTokenResult(request);
    public ApsPersistedTokenStatus GetPersistedTokenStatus(ApsTokenRequest request) =>
        ApsAuthenticationService.GetPersistedTokenStatus(authTokenProvider.GetClientId(), request);

    public void ClearPersistedTokens() =>
        ApsAuthenticationService.ClearPersistedTokens(authTokenProvider.GetClientId());

    public interface IOAuthTokenProvider : IApsCredentialProvider;

    public sealed class StaticAuthTokenProvider(string clientId, string? clientSecret) : IOAuthTokenProvider {
        public string GetClientId() => clientId;
        public string GetClientSecret() => clientSecret ?? "";
    }
}
