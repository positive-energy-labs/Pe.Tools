using Pe.Revit.Global.Services.Aps.Core;
using Pe.Revit.Global.Services.Aps.Models;
using System.Net.Http.Headers;

namespace Pe.Revit.Global.Services.Aps;

public class Aps(TokenProviders.IAuth authTokenProvider) {
    private readonly OAuth _oAuth = new(authTokenProvider);

    private HttpClient HttpClient => new() {
        BaseAddress = new Uri("https://developer.api.autodesk.com/"),
        DefaultRequestHeaders = {
            Accept = { new MediaTypeWithQualityHeaderValue("application/json") },
            Authorization = new AuthenticationHeaderValue("Bearer", this._oAuth.GetToken())
        }
    };

    public Parameters Parameters(TokenProviders.IParameters parametersTokenProvider) =>
        new(this.HttpClient, parametersTokenProvider);

    public Hubs Hubs() => new(this.HttpClient);
    public string GetToken() => this._oAuth.GetToken();

    public interface IOAuthTokenProvider : TokenProviders.IAuth;

    public interface IParametersTokenProvider : TokenProviders.IParameters;


    // public Models.OAuth ApsBaseSettings(): Global settings model placeholder => new();
}
