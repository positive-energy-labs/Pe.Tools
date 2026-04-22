using Pe.Shared.Aps.Core;
using Pe.Shared.Aps.Models;
using System.Net.Http.Headers;

namespace Pe.Shared.Aps;

public class Aps(TokenProviders.IAuth authTokenProvider) {
    private const string DeveloperApiBaseUrl = "https://developer.api.autodesk.com/";
    private const string AutomationApiBaseUrl = "https://developer.api.autodesk.com/da/us-east/v3/";
    private readonly OAuth _oAuth = new(authTokenProvider);

    private HttpClient CreateHttpClient(ApsTokenRequest request, string baseUrl = DeveloperApiBaseUrl) => new() {
        BaseAddress = new Uri(baseUrl),
        DefaultRequestHeaders = {
            Accept = { new MediaTypeWithQualityHeaderValue("application/json") },
            Authorization = new AuthenticationHeaderValue("Bearer", this._oAuth.GetToken(request))
        }
    };

    public Hubs Hubs() => new(this.CreateHttpClient(ApsTokenRequest.ForParameterService()));

    public DataManagementApiClient DataManagement() =>
        new(this.CreateHttpClient(ApsTokenRequest.ForParameterService()));

    public AutomationApiClient Automation() =>
        new(
            this.CreateHttpClient(ApsTokenRequest.ForAutomationManagement(), AutomationApiBaseUrl),
            authTokenProvider.GetClientId()
        );

    public string GetToken() => this._oAuth.GetToken();
    public string GetToken(ApsTokenRequest request) => this._oAuth.GetToken(request);
    public ApsTokenResult GetTokenResult(ApsTokenRequest request) => this._oAuth.GetTokenResult(request);

    public interface IOAuthTokenProvider : TokenProviders.IAuth;

    // public Models.OAuth ApsBaseSettings(): Global settings model placeholder => new();
}