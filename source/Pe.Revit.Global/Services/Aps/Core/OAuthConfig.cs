namespace Pe.Revit.Global.Services.Aps.Core;

/// <summary>
///     Centralized OAuth endpoint and callback constants.
/// </summary>
internal static class OAuthConfig {
    internal const string AuthorizeEndpoint = "https://developer.api.autodesk.com/authentication/v2/authorize";
    internal const string TokenEndpoint = "https://developer.api.autodesk.com/authentication/v2/token";

    internal const int CallbackPort = 8080;
    internal static readonly string CallbackUri = $"http://localhost:{CallbackPort}/api/aps/callback/oauth";

    /// <summary>
    ///     Shared HttpClient for token requests to avoid socket churn.
    /// </summary>
    internal static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(30) };
}
