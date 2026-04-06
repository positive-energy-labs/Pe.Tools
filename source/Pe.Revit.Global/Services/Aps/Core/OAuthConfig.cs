namespace Pe.Global.Services.Aps.Core;

/// <summary>
///     Centralized OAuth configuration.
///     All settings in one place - change once, affects everywhere.
/// </summary>
internal static class OAuthConfig {
    // Endpoints
    internal const string AuthorizeEndpoint = "https://developer.api.autodesk.com/authentication/v2/authorize";
    internal const string TokenEndpoint = "https://developer.api.autodesk.com/authentication/v2/token";

    // Callback configuration
    internal const int CallbackPort = 8080;
    internal static readonly string CallbackUri = $"http://localhost:{CallbackPort}/api/aps/callback/oauth";

    /// <summary>OAuth scopes requested during authorization</summary>
    internal static readonly string[] RequestedScopes = [
        "account:read",
        "data:create",
        "data:write",
        "data:read",
        "bucket:read"
    ];

    /// <summary>
    ///     Static HttpClient - best practice for avoiding socket exhaustion.
    ///     Owned here because it's a shared infrastructure concern.
    /// </summary>
    internal static readonly HttpClient HttpClient = new() { Timeout = TimeSpan.FromSeconds(30) };
}