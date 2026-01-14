using System.Security.Cryptography;

namespace Pe.Global.Services.Aps.Core;

/// <summary>
///     Encapsulates the data needed for an OAuth flow.
///     Immutable record ensures thread safety.
///     Self-contained: includes its own PKCE generation (no external dependencies).
/// </summary>
internal sealed record OAuthFlowData {
    public required string ClientId { get; init; }
    public string? ClientSecret { get; init; }
    public string? CodeVerifier { get; init; }

    /// <summary>True if this is a PKCE (public client) flow</summary>
    public bool IsPkce => this.CodeVerifier != null;

    /// <summary>
    ///     Factory method that validates inputs and creates the appropriate flow type.
    /// </summary>
    public static OAuthFlowData Create(string clientId, string clientSecret) {
        if (string.IsNullOrEmpty(clientId))
            throw new ArgumentException("ClientId is required", nameof(clientId));

        // Determine flow type: if client secret provided, use confidential flow; otherwise PKCE
        var useConfidentialFlow = !string.IsNullOrEmpty(clientSecret);

        return new OAuthFlowData {
            ClientId = clientId,
            ClientSecret = useConfidentialFlow ? clientSecret : null,
            CodeVerifier = useConfidentialFlow ? null : GenerateRandomString()
        };
    }

    /// <summary>Generates the PKCE code challenge for this flow (S256 method)</summary>
    public string GenerateCodeChallenge() {
        if (!this.IsPkce)
            throw new InvalidOperationException("Code challenge only available for PKCE flows");

        if (string.IsNullOrEmpty(this.CodeVerifier))
            throw new InvalidOperationException("CodeVerifier is null or empty");

        using var sha256 = SHA256.Create();
        var hash = sha256.ComputeHash(Encoding.UTF8.GetBytes(this.CodeVerifier));
        var base64 = Convert.ToBase64String(hash);

        // Convert to URL-safe base64 (RFC 7636)
        return base64
            .Replace("+", "-")
            .Replace("/", "_")
            .TrimEnd('=');
    }

    #region Private PKCE Helpers

    private static readonly RandomNumberGenerator CryptoRng = RandomNumberGenerator.Create();

    /// <summary>Generates a cryptographically random string for PKCE verifier/nonce</summary>
    internal static string GenerateRandomString(int length = 128) {
        const string allowedChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
        var bytes = new byte[length];
        CryptoRng.GetBytes(bytes);
        return new string(bytes.Select(b => allowedChars[b % allowedChars.Length]).ToArray());
    }

    #endregion
}