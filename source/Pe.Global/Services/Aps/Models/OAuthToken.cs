using Newtonsoft.Json;

namespace Pe.Global.Services.Aps.Models;

/// <summary>
///     Response model for Autodesk OAuth token endpoints.
///     Replaces SDK's ThreeLeggedToken for direct REST API usage.
/// </summary>
public class OAuthToken {
    [JsonProperty("access_token")] public string? AccessToken { get; set; }

    [JsonProperty("token_type")] public string? TokenType { get; set; }

    [JsonProperty("expires_in")] public int? ExpiresIn { get; set; }

    [JsonProperty("refresh_token")] public string? RefreshToken { get; set; }
}