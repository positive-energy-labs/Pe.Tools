using Newtonsoft.Json;
using Pe.Global.Services.Aps.Models;
using System.Net;
using System.Net.Sockets;

namespace Pe.Global.Services.Aps.Core;

/// <summary>
///     Handles OAuth 2.0 authentication flow using direct REST API calls.
///     Opens the user's default browser for authorization, then captures the callback.
/// </summary>
/// <remarks>
///     <list type="bullet">
///         <item>Uses TCP listener (not HTTP) to avoid admin privilege requirements</item>
///         <item>Migrated from Autodesk.Authentication SDK to avoid DLL conflicts</item>
///         <item>Supports both confidential (client secret) and public (PKCE) flows</item>
///     </list>
/// </remarks>
internal static class OAuthHandler {
    #region Authorization URL

    /// <summary>Generates the OAuth authorization URL with all required parameters</summary>
    private static string BuildAuthorizationUrl(OAuthFlowData flow) {
        var scopeParam = Uri.EscapeDataString(string.Join(" ", OAuthConfig.RequestedScopes));
        var redirectParam = Uri.EscapeDataString(OAuthConfig.CallbackUri);

        var url = $"{OAuthConfig.AuthorizeEndpoint}?response_type=code" +
                  $"&client_id={flow.ClientId}" +
                  $"&redirect_uri={redirectParam}" +
                  $"&scope={scopeParam}";

        // Add PKCE parameters for public client flow
        if (flow.IsPkce) {
            var codeChallenge = flow.GenerateCodeChallenge();
            var nonce = OAuthFlowData.GenerateRandomString(32);
            url += $"&code_challenge={codeChallenge}&code_challenge_method=S256&nonce={nonce}";
        }

        return url;
    }

    #endregion

    #region Public API

    /// <summary>Delegate invoked when 3-legged OAuth completes</summary>
    /// <param name="token">The token if successful, null if failed/denied</param>
    public delegate void CallbackDelegate(OAuthToken? token);

    /// <summary>
    ///     Initiates the 3-legged OAuth flow, opening the browser for user authorization.
    /// </summary>
    /// <param name="clientId">The application client ID</param>
    /// <param name="clientSecret">The client secret (null/empty for PKCE flow)</param>
    /// <param name="callback">Callback invoked with the result</param>
    public static void Invoke3LeggedOAuth(string clientId, string clientSecret, CallbackDelegate callback) {
        var flowData = OAuthFlowData.Create(clientId, clientSecret);
        var authUrl = BuildAuthorizationUrl(flowData);
        ExecuteOAuthFlow(authUrl, flowData, callback);
    }

    /// <summary>
    ///     Refreshes an access token using a refresh token.
    /// </summary>
    /// <param name="clientId">The application client ID</param>
    /// <param name="clientSecret">The client secret (can be null for PKCE flow)</param>
    /// <param name="refreshToken">The refresh token to use</param>
    /// <param name="cancellationToken">Cancellation token for timeout control</param>
    /// <returns>A new OAuthToken with refreshed access token</returns>
    /// <exception cref="ArgumentException">If refresh token is null/empty</exception>
    /// <exception cref="HttpRequestException">If the HTTP request fails</exception>
    /// <exception cref="OperationCanceledException">If the operation is cancelled or times out</exception>
    public static async Task<OAuthToken> RefreshTokenAsync(
        string clientId,
        string clientSecret,
        string refreshToken,
        CancellationToken cancellationToken = default) {
        if (string.IsNullOrEmpty(refreshToken))
            throw new ArgumentException("Refresh token cannot be null or empty", nameof(refreshToken));

        var formData = BuildTokenRequestForm(
            "refresh_token",
            clientId,
            clientSecret,
            new Dictionary<string, string> { ["refresh_token"] = refreshToken }
        );

        // PostTokenRequestAsync can return null on deserialization failure - throw in that case
        return await PostTokenRequestAsync(formData, cancellationToken).ConfigureAwait(false)
               ?? throw new HttpRequestException("Token response could not be parsed");
    }

    #endregion

    #region OAuth Flow Execution

    // TCP listener for receiving OAuth callbacks - static because only one OAuth flow can run at a time
    private static readonly TcpListener TcpListener = new(IPAddress.Loopback, OAuthConfig.CallbackPort);

    /// <summary>
    ///     Executes the OAuth flow: opens browser, waits for callback, exchanges code for token.
    /// </summary>
    private static void ExecuteOAuthFlow(string authUrl, OAuthFlowData flowData, CallbackDelegate callback) {
        try {
            // Ensure clean state
            TcpListener.Stop();
            TcpListener.Start();

            if (((IPEndPoint)TcpListener.LocalEndpoint).Port != OAuthConfig.CallbackPort)
                throw new InvalidOperationException($"Failed to bind TCP listener to port {OAuthConfig.CallbackPort}");

            // Open browser for user authorization
            _ = Process.Start(new ProcessStartInfo(authUrl) { UseShellExecute = true });

            // Handle callback asynchronously
            _ = Task.Run(async () => await HandleCallbackAsync(flowData, callback).ConfigureAwait(false));
        } catch {
            // TODO: update this to give feedback
            callback?.Invoke(null);
        }
    }

    /// <summary>
    ///     Handles the OAuth callback: reads the authorization code, exchanges it for a token.
    /// </summary>
    private static async Task HandleCallbackAsync(OAuthFlowData flowData, CallbackDelegate callback) {
        try {
            var authorizationCode = await WaitForAuthorizationCodeAsync().ConfigureAwait(false);

            // Exchange code for token
            if (!string.IsNullOrEmpty(authorizationCode)) {
                var token = await ExchangeCodeForTokenAsync(flowData, authorizationCode).ConfigureAwait(false);
                callback?.Invoke(token);
            } else
                callback?.Invoke(null);
        } catch {
            // TODO: update this to give feedback
            callback?.Invoke(null);
        } finally {
            TcpListener.Stop();
        }
    }

    #endregion

    #region Token Exchange

    /// <summary>Exchanges an authorization code for an access token</summary>
    private static Task<OAuthToken> ExchangeCodeForTokenAsync(OAuthFlowData flow, string code) {
        var additionalParams = new Dictionary<string, string> {
            ["code"] = code, ["redirect_uri"] = OAuthConfig.CallbackUri
        };

        // PKCE flow sends code_verifier, confidential flow sends client_secret
        // CodeVerifier is guaranteed to be set for PKCE flows
        if (flow.IsPkce)
            additionalParams["code_verifier"] = flow.CodeVerifier!;

        var formData = BuildTokenRequestForm(
            "authorization_code",
            flow.ClientId,
            flow.IsPkce ? null : flow.ClientSecret,
            additionalParams
        );

        return PostTokenRequestAsync(formData, CancellationToken.None);
    }

    /// <summary>Builds the form data for a token request</summary>
    private static Dictionary<string, string> BuildTokenRequestForm(
        string grantType,
        string clientId,
        string? clientSecret,
        Dictionary<string, string> additionalParams) {
        var form = new Dictionary<string, string> { ["grant_type"] = grantType, ["client_id"] = clientId };

        // Only include client_secret for confidential clients
        if (!string.IsNullOrEmpty(clientSecret))
            form["client_secret"] = clientSecret;

        // Add any additional parameters
        foreach (var (key, value) in additionalParams)
            form[key] = value;

        return form;
    }

    /// <summary>Posts a token request and deserializes the response</summary>
    private static async Task<OAuthToken?> PostTokenRequestAsync(
        Dictionary<string, string> formData,
        CancellationToken cancellationToken) {
        using var content = new FormUrlEncodedContent(formData);
        var response = await OAuthConfig.HttpClient.PostAsync(OAuthConfig.TokenEndpoint, content, cancellationToken)
            .ConfigureAwait(false);

        var responseBody = await response.Content.ReadAsStringAsync().ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException($"Token request failed: {response.StatusCode} - {responseBody}");

        var token = JsonConvert.DeserializeObject<OAuthToken>(responseBody);
        return token ?? throw new JsonSerializationException("Token response could not be parsed");
    }

    #endregion

    #region Callback Listener

    /// <summary>
    ///     Accepts the OAuth callback, reads the authorization code and returns it after responding to the browser.
    /// </summary>
    private static async Task<string> WaitForAuthorizationCodeAsync() {
        var client = await TcpListener.AcceptTcpClientAsync().ConfigureAwait(false);
        var request = ReadHttpRequest(client);
        var authorizationCode = ExtractAuthorizationCode(request);

        // Send response page to browser
        var responsePage = string.IsNullOrEmpty(authorizationCode)
            ? OAuthCallbackPages.ErrorPage
            : OAuthCallbackPages.SuccessPage;
        await WriteHttpResponseAsync(client, responsePage).ConfigureAwait(false);
        client.Dispose();

        if (authorizationCode is null)
            throw new InvalidOperationException("Authorization code not found");

        return authorizationCode;
    }

    /// <summary>Reads an HTTP request from a TCP client</summary>
    private static string ReadHttpRequest(TcpClient client) {
        var buffer = new byte[client.ReceiveBufferSize];
        using var memoryStream = new MemoryStream();
        var networkStream = client.GetStream();

        while (networkStream.DataAvailable) {
            var bytesRead = networkStream.Read(buffer, 0, buffer.Length);
            if (bytesRead <= 0) break;
            memoryStream.Write(buffer, 0, bytesRead);
        }

        return Encoding.UTF8.GetString(memoryStream.ToArray());
    }

    /// <summary>Writes an HTTP response to a TCP client</summary>
    private static Task WriteHttpResponseAsync(TcpClient client, string body) =>
        Task.Run(() => {
            using var writer = new StreamWriter(client.GetStream(), new UTF8Encoding(false));
            writer.Write("HTTP/1.0 200 OK\r\n");
            writer.Write("Content-Type: text/html; charset=UTF-8\r\n");
            writer.Write($"Content-Length: {body.Length}\r\n");
            writer.Write("Connection: close\r\n");
            writer.Write("\r\n");
            writer.Write(body);
            writer.Flush();
        });

    /// <summary>Extracts the authorization code from an HTTP GET request</summary>
    private static string? ExtractAuthorizationCode(string httpRequest) {
        var lines = httpRequest.Split('\n');
        if (lines.Length == 0) return null;

        var requestLine = lines[0].Trim();
        if (!requestLine.StartsWith("GET ")) return null;

        var parts = requestLine.Split(' ');
        if (parts.Length < 2) return null;

        var queryStart = parts[1].IndexOf('?');
        if (queryStart < 0) return null;

        var queryString = parts[1][(queryStart + 1)..];
        var parameters = queryString
            .Split('&')
            .Select(p => p.Split('='))
            .Where(kv => kv.Length == 2)
            .ToDictionary(kv => kv[0], kv => kv[1]);

        return parameters.GetValueOrDefault("code");
    }

    #endregion
}