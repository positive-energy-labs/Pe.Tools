using Pe.Shared.ApsAuth;
using Autodesk.Authentication;
using Autodesk.Authentication.Model;
using Autodesk.SDKManager;
using Pe.Aps.Auth;
using Serilog;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Pe.Aps.Core;

internal sealed class ApsAuthenticationService(IApsCredentialProvider credentialProvider) {
    private static readonly PersistedApsTokenStore PersistedTokenStore = new();
    private static readonly AuthenticationClient AuthenticationClient = new(SdkManagerBuilder.Create().Build());
    private static readonly object TokenMutationLock = new();
    private static readonly object InteractiveAuthorizationLock = new();
    private static readonly IReadOnlyDictionary<string, Scopes> ScopeMap =
        new Dictionary<string, Scopes>(StringComparer.OrdinalIgnoreCase) {
            ["account:read"] = Scopes.AccountRead,
            ["account:write"] = Scopes.AccountWrite,
            ["bucket:create"] = Scopes.BucketCreate,
            ["bucket:delete"] = Scopes.BucketDelete,
            ["bucket:read"] = Scopes.BucketRead,
            ["bucket:update"] = Scopes.BucketUpdate,
            ["code:all"] = Scopes.CodeAll,
            ["data:create"] = Scopes.DataCreate,
            ["data:read"] = Scopes.DataRead,
            ["data:search"] = Scopes.DataSearch,
            ["data:write"] = Scopes.DataWrite,
            ["openid"] = Scopes.OpenId,
            ["user-profile:read"] = Scopes.UserProfileRead,
            ["user:read"] = Scopes.UserRead,
            ["user:write"] = Scopes.UserWrite,
            ["viewables:read"] = Scopes.ViewablesRead
        };

    private readonly IApsCredentialProvider _credentialProvider = credentialProvider;

    private const int CallbackPort = 8080;
    private const int DefaultExpirationSeconds = 3600;
    private const int ExpirationBufferSeconds = 60;
    private static readonly Uri CallbackUri = new($"http://localhost:{CallbackPort}/api/aps/callback/oauth");
    private static readonly TimeSpan InteractiveAuthorizationTimeout = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan RefreshTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ClientCredentialsTimeout = TimeSpan.FromSeconds(15);

    public string GetToken() => this.GetToken(ApsTokenRequest.ForParameterService());

    public string GetToken(ApsTokenRequest request) => this.GetTokenResult(request).AccessToken;

    public ApsTokenResult GetTokenResult(ApsTokenRequest request) {
        var clientId = this._credentialProvider.GetClientId();
        if (string.IsNullOrWhiteSpace(clientId))
            throw new InvalidOperationException("APS client id is not configured.");

        var scopes = request.ResolveScopes();
        var tokenKey = new TokenStoreKey(clientId, request.FlowKind, string.Join(" ", scopes));
        var clientSecret = request.FlowKind switch {
            ApsAuthFlowKind.TwoLegged => RequireClientSecret(this._credentialProvider.GetClientSecret(), request),
            ApsAuthFlowKind.ThreeLeggedConfidential => RequireClientSecret(this._credentialProvider.GetClientSecret(), request),
            _ => throw new ArgumentOutOfRangeException(nameof(request.FlowKind), request.FlowKind, null)
        };

        var persistedToken = TryLoadPersistedToken(tokenKey);
        if (persistedToken != null && !ShouldRefresh(persistedToken))
            return CreateTokenResult(persistedToken, request);

        if (request.FlowKind == ApsAuthFlowKind.ThreeLeggedConfidential &&
            !string.IsNullOrWhiteSpace(persistedToken?.RefreshToken)) {
            var refreshedToken = TryRefreshTokenWithRaceProtection(
                tokenKey,
                clientSecret,
                persistedToken.RefreshToken,
                scopes
            );

            if (refreshedToken != null)
                return CreateTokenResult(refreshedToken, request);
        }

        return request.FlowKind switch {
            ApsAuthFlowKind.TwoLegged => PerformClientCredentialsFlow(clientId, clientSecret, tokenKey, request, scopes),
            ApsAuthFlowKind.ThreeLeggedConfidential => PerformInteractiveAuthorizationFlow(clientId, clientSecret, tokenKey, request, scopes),
            _ => throw new ArgumentOutOfRangeException(nameof(request.FlowKind), request.FlowKind, null)
        };
    }

    private static ApsTokenResult PerformClientCredentialsFlow(
        string clientId,
        string clientSecret,
        TokenStoreKey tokenKey,
        ApsTokenRequest request,
        IReadOnlyList<string> scopes
    ) {
        using var cts = new CancellationTokenSource(ClientCredentialsTimeout);
        var token = AuthenticationClient
            .GetTwoLeggedTokenAsync(clientId, clientSecret, ToSdkScopes(scopes), true)
            .WaitAsync(cts.Token)
            .ConfigureAwait(false)
            .GetAwaiter()
            .GetResult();

        var tokenRecord = CreatePersistedTokenRecord(token);
        PersistToken(tokenKey, tokenRecord);
        return CreateTokenResult(tokenRecord, request);
    }

    private static ApsTokenResult PerformInteractiveAuthorizationFlow(
        string clientId,
        string clientSecret,
        TokenStoreKey tokenKey,
        ApsTokenRequest request,
        IReadOnlyList<string> scopes
    ) {
        lock (InteractiveAuthorizationLock) {
            var currentToken = TryLoadPersistedToken(tokenKey);
            if (currentToken != null && !ShouldRefresh(currentToken))
                return CreateTokenResult(currentToken, request);

            var state = Guid.NewGuid().ToString("N");
            using var listener = new LoopbackAuthorizationListener();
            listener.Start();

            var authorizeUrl = AuthenticationClient.Authorize(
                clientId,
                ResponseType.Code,
                CallbackUri.ToString(),
                ToSdkScopes(scopes),
                state: state
            );

            try {
                _ = Process.Start(new ProcessStartInfo(authorizeUrl) { UseShellExecute = true });
            } catch (Exception ex) {
                throw new InvalidOperationException("Failed to open the APS authorization browser.", ex);
            }

            using var cts = new CancellationTokenSource(InteractiveAuthorizationTimeout);
            var callback = listener.WaitForCallbackAsync(cts.Token)
                .ConfigureAwait(false)
                .GetAwaiter()
                .GetResult();

            if (!string.IsNullOrWhiteSpace(callback.Error))
                throw new InvalidOperationException(
                    $"APS authorization failed: {callback.ErrorDescription ?? callback.Error}"
                );

            if (!string.Equals(callback.State, state, StringComparison.Ordinal))
                throw new InvalidOperationException("APS authorization callback state did not match the request.");

            if (string.IsNullOrWhiteSpace(callback.Code))
                throw new InvalidOperationException("APS authorization callback did not include an authorization code.");

            var token = AuthenticationClient
                .GetThreeLeggedTokenAsync(clientId, callback.Code, CallbackUri.ToString(), clientSecret, null, true)
                .ConfigureAwait(false)
                .GetAwaiter()
                .GetResult();

            var tokenRecord = CreatePersistedTokenRecord(token);
            PersistToken(tokenKey, tokenRecord);
            return CreateTokenResult(tokenRecord, request);
        }
    }

    private sealed record TokenStoreKey(string ClientId, ApsAuthFlowKind FlowKind, string ScopeKey);

    private static PersistedTokenRecord CreatePersistedTokenRecord(TwoLeggedToken token) =>
        new() {
            AccessToken = token.AccessToken ?? throw new InvalidOperationException("APS did not return an access token."),
            RefreshToken = "",
            ExpiresAtUtc = ResolveExpiryUtc(token.ExpiresAt, token.ExpiresIn)
        };

    private static PersistedTokenRecord CreatePersistedTokenRecord(
        ThreeLeggedToken token,
        string? fallbackRefreshToken = null
    ) =>
        new() {
            AccessToken = token.AccessToken ?? throw new InvalidOperationException("APS did not return an access token."),
            RefreshToken = token.RefreshToken ?? fallbackRefreshToken ?? "",
            ExpiresAtUtc = ResolveExpiryUtc(token.ExpiresAt, token.ExpiresIn)
        };

    private static DateTime ResolveExpiryUtc(long? expiresAtUnixSeconds, int? expiresInSeconds) =>
        expiresAtUnixSeconds.HasValue
            ? DateTimeOffset.FromUnixTimeSeconds(expiresAtUnixSeconds.Value).UtcDateTime
            : DateTime.UtcNow.AddSeconds(expiresInSeconds ?? DefaultExpirationSeconds);

    private static ApsTokenResult CreateTokenResult(PersistedTokenRecord token, ApsTokenRequest request) =>
        new(
            token.AccessToken,
            token.ExpiresAtUtc,
            string.IsNullOrWhiteSpace(token.RefreshToken) ? null : token.RefreshToken,
            request.ScopeProfile,
            request.FlowKind
        );

    private static bool ShouldRefresh(PersistedTokenRecord token) =>
        DateTime.UtcNow >= token.ExpiresAtUtc.AddSeconds(-ExpirationBufferSeconds);

    private static PersistedTokenRecord? TryRefreshTokenWithRaceProtection(
        TokenStoreKey tokenKey,
        string clientSecret,
        string refreshToken,
        IReadOnlyList<string> scopes
    ) {
        lock (TokenMutationLock) {
            var currentToken = TryLoadPersistedToken(tokenKey);
            if (currentToken != null && !ShouldRefresh(currentToken))
                return currentToken;

            var refreshTokenToUse = string.IsNullOrWhiteSpace(currentToken?.RefreshToken)
                ? refreshToken
                : currentToken.RefreshToken;
            var refreshedToken = ExecuteTokenRefresh(tokenKey.ClientId, clientSecret, refreshTokenToUse, scopes);
            if (refreshedToken == null)
                return null;

            var newRecord = CreatePersistedTokenRecord(refreshedToken, refreshTokenToUse);
            PersistToken(tokenKey, newRecord);
            return newRecord;
        }
    }

    private static ThreeLeggedToken? ExecuteTokenRefresh(
        string clientId,
        string clientSecret,
        string refreshToken,
        IReadOnlyList<string> scopes
    ) {
        try {
            using var cts = new CancellationTokenSource(RefreshTimeout);
            return AuthenticationClient
                .RefreshTokenAsync(refreshToken, clientId, clientSecret, ToSdkScopes(scopes), true)
                .WaitAsync(cts.Token)
                .ConfigureAwait(false)
                .GetAwaiter()
                .GetResult();
        } catch (Exception ex) {
            Log.Warning(ex, "APS refresh token flow failed for client {ClientId}.", clientId);
            return null;
        }
    }

    private static PersistedTokenRecord? TryLoadPersistedToken(TokenStoreKey tokenKey) {
        var persisted = PersistedTokenStore.Load(ToPersistenceKey(tokenKey));
        return string.IsNullOrWhiteSpace(persisted?.AccessToken) ? null : persisted;
    }

    private static void PersistToken(TokenStoreKey tokenKey, PersistedTokenRecord token) {
        if (string.IsNullOrWhiteSpace(token.AccessToken))
            return;

        PersistedTokenStore.Save(ToPersistenceKey(tokenKey), token);
    }

    private static string ToPersistenceKey(TokenStoreKey tokenKey) =>
        string.Join("|", tokenKey.ClientId, tokenKey.FlowKind, tokenKey.ScopeKey);

    internal static ApsPersistedTokenStatus GetPersistedTokenStatus(
        string clientId,
        ApsTokenRequest request
    ) {
        var tokenKey = new TokenStoreKey(clientId, request.FlowKind, string.Join(" ", request.ResolveScopes()));
        var persisted = PersistedTokenStore.Load(ToPersistenceKey(tokenKey));
        return new ApsPersistedTokenStatus(
            persisted != null,
            persisted?.ExpiresAtUtc,
            !string.IsNullOrWhiteSpace(persisted?.RefreshToken),
            request.ScopeProfile,
            request.FlowKind
        );
    }

    internal static void ClearPersistedTokens(string clientId) =>
        PersistedTokenStore.DeleteByClientId(clientId);

    private static string RequireClientSecret(string? clientSecret, ApsTokenRequest request) {
        if (!string.IsNullOrWhiteSpace(clientSecret))
            return clientSecret;

        throw request.FlowKind switch {
            ApsAuthFlowKind.TwoLegged => new InvalidOperationException("A client secret is required for 2-legged APS authentication."),
            ApsAuthFlowKind.ThreeLeggedConfidential => new InvalidOperationException(
                "A client secret is required for shared APS 3-legged authentication. Use the configured web app credentials."
            ),
            _ => new ArgumentOutOfRangeException(nameof(request.FlowKind), request.FlowKind, null)
        };
    }

    private static List<Scopes> ToSdkScopes(IReadOnlyList<string> scopes) =>
        scopes.Select(scope =>
            ScopeMap.TryGetValue(scope, out var sdkScope)
                ? sdkScope
                : throw new NotSupportedException($"APS scope '{scope}' is not mapped in Pe.Aps yet.")
        ).ToList();

    private sealed class LoopbackAuthorizationListener : IDisposable {
        private readonly TcpListener _listener = new(IPAddress.Loopback, CallbackPort);
        private bool _started;

        public void Start() {
            if (_started)
                return;

            this._listener.Start();
            var endpoint = (IPEndPoint)this._listener.LocalEndpoint;
            if (endpoint.Port != CallbackPort)
                throw new InvalidOperationException($"Failed to bind APS callback listener to port {CallbackPort}.");

            this._started = true;
        }

        public async Task<AuthorizationCallback> WaitForCallbackAsync(CancellationToken cancellationToken) {
            using var client = await this._listener.AcceptTcpClientAsync(cancellationToken).ConfigureAwait(false);
            await using var stream = client.GetStream();
            using var reader = new StreamReader(stream, Encoding.UTF8, false, 4096, true);

            var requestLine = await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false);
            while (!string.IsNullOrEmpty(await reader.ReadLineAsync(cancellationToken).ConfigureAwait(false))) {
            }

            var callback = ParseCallback(requestLine);
            await WriteHtmlResponseAsync(stream, callback).ConfigureAwait(false);
            return callback;
        }

        private static AuthorizationCallback ParseCallback(string? requestLine) {
            if (string.IsNullOrWhiteSpace(requestLine))
                throw new InvalidOperationException("APS authorization callback was empty.");

            var parts = requestLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || !string.Equals(parts[0], "GET", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("APS authorization callback used an unsupported request format.");

            var requestUri = new Uri($"http://localhost{parts[1]}", UriKind.Absolute);
            var query = ParseQueryString(requestUri.Query);
            return new AuthorizationCallback(
                ReadQueryValue(query, "code"),
                ReadQueryValue(query, "state"),
                ReadQueryValue(query, "error"),
                ReadQueryValue(query, "error_description")
            );
        }

        private static Dictionary<string, string> ParseQueryString(string query) =>
            query.TrimStart('?')
                .Split('&', StringSplitOptions.RemoveEmptyEntries)
                .Select(segment => segment.Split('=', 2))
                .ToDictionary(
                    pair => Uri.UnescapeDataString(pair[0]),
                    pair => Uri.UnescapeDataString(pair.Length > 1 ? pair[1] : ""),
                    StringComparer.OrdinalIgnoreCase
                );

        private static string? ReadQueryValue(IReadOnlyDictionary<string, string> query, string key) =>
            query.TryGetValue(key, out var value) && !string.IsNullOrWhiteSpace(value) ? value : null;

        private static async Task WriteHtmlResponseAsync(NetworkStream stream, AuthorizationCallback callback) {
            var body = string.IsNullOrWhiteSpace(callback.Error)
                ? """
                  <html><body><h2>APS authentication complete</h2><p>You can close this window.</p></body></html>
                  """
                : $"""
                   <html><body><h2>APS authentication failed</h2><p>{WebUtility.HtmlEncode(callback.ErrorDescription ?? callback.Error)}</p></body></html>
                   """;

            await using var writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true);
            await writer.WriteAsync("HTTP/1.1 200 OK\r\n").ConfigureAwait(false);
            await writer.WriteAsync("Content-Type: text/html; charset=UTF-8\r\n").ConfigureAwait(false);
            await writer.WriteAsync($"Content-Length: {Encoding.UTF8.GetByteCount(body)}\r\n").ConfigureAwait(false);
            await writer.WriteAsync("Connection: close\r\n\r\n").ConfigureAwait(false);
            await writer.WriteAsync(body).ConfigureAwait(false);
            await writer.FlushAsync().ConfigureAwait(false);
        }

        public void Dispose() {
            if (this._started)
                this._listener.Stop();
        }
    }

    private sealed record AuthorizationCallback(
        string? Code,
        string? State,
        string? Error,
        string? ErrorDescription
    );
}
