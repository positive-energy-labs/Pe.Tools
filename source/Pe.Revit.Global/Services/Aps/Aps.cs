using Pe.Revit.Global.Services.Aps.Core;
using Pe.Revit.Global.Services.Aps.Models;
using System.Net.Http.Headers;

namespace Pe.Revit.Global.Services.Aps;

public class Aps(TokenProviders.IAuth authTokenProvider) {
    private readonly OAuth _oAuth = new(authTokenProvider);
    private const string DeveloperApiBaseUrl = "https://developer.api.autodesk.com/";
    private const string AutomationApiBaseUrl = "https://developer.api.autodesk.com/da/us-east/v3/";

    private HttpClient CreateHttpClient(ApsTokenRequest request, string baseUrl = DeveloperApiBaseUrl) => new() {
        BaseAddress = new Uri(baseUrl),
        DefaultRequestHeaders = {
            Accept = { new MediaTypeWithQualityHeaderValue("application/json") },
            Authorization = new AuthenticationHeaderValue("Bearer", this._oAuth.GetToken(request))
        }
    };

    public Parameters Parameters(TokenProviders.IParameters parametersTokenProvider) =>
        new(this.CreateHttpClient(ApsTokenRequest.ForParameterService()), parametersTokenProvider);

    public Hubs Hubs() => new(this.CreateHttpClient(ApsTokenRequest.ForParameterService()));
    public DataManagementApiClient DataManagement() => new(this.CreateHttpClient(ApsTokenRequest.ForParameterService()));
    public AutomationApiClient Automation() =>
        new(
            this.CreateHttpClient(ApsTokenRequest.ForAutomationManagement(), AutomationApiBaseUrl),
            authTokenProvider.GetClientId()
        );

    public string GetToken() => this._oAuth.GetToken();
    public string GetToken(ApsTokenRequest request) => this._oAuth.GetToken(request);
    public ApsTokenResult GetTokenResult(ApsTokenRequest request) => this._oAuth.GetTokenResult(request);

    public interface IOAuthTokenProvider : TokenProviders.IAuth;

    public interface IParametersTokenProvider : TokenProviders.IParameters;


    // public Models.OAuth ApsBaseSettings(): Global settings model placeholder => new();
}
