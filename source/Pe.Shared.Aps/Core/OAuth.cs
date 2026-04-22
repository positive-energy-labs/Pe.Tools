using Pe.Shared.Aps.Models;
using Serilog;

namespace Pe.Shared.Aps.Core;

/// <summary>
///     Autodesk Platform Services Authentication Handler.
///     <para>
///         Instances of this class with the same credentials share their tokens.
///         Refreshing from one instance refreshes for all instances with the same credentials.
///     </para>
/// </summary>
/// <remarks>
///     <list type="bullet">
///         <item>Uses TCP listener (not HTTP) to sidestep admin privilege requirements</item>
///         <item>Supports automatic token refresh to minimize re-authentication prompts</item>
///         <item>Thread-safe with minimal lock contention</item>
///     </list>
/// </remarks>
public class OAuth(TokenProviders.IAuth tokenProvider) {
    private readonly TokenProviders.IAuth _tokenProvider = tokenProvider;

    /// <summary>
    ///     Gets a valid access token, refreshing automatically if possible, or prompting for re-auth if needed.
    /// </summary>
    /// <returns>A valid access token string</returns>
    /// <exception cref="Exception">Thrown if authentication was denied or failed</exception>
    public string GetToken() => this.GetToken(ApsTokenRequest.ForParameterService());

    public string GetToken(ApsTokenRequest request) => this.GetTokenResult(request).AccessToken;

    public ApsTokenResult GetTokenResult(ApsTokenRequest request) {
        var clientId = this._tokenProvider.GetClientId();
        if (string.IsNullOrEmpty(clientId))
            throw new InvalidOperationException("ClientId is not set");

        var clientSecret = this._tokenProvider.GetClientSecret();
        var scopes = request.ResolveScopes();
        var cacheKey = new CacheKey(clientId, request.FlowKind, string.Join(" ", scopes));

        // PHASE 1: Quick cache read under lock (fast path)
        var (cachedToken, needsRefresh) = ReadCacheState(cacheKey);
        if (cachedToken != null && !needsRefresh)
            return CreateTokenResult(cachedToken, request);

        // PHASE 2: Attempt token refresh outside lock (slow path, no blocking)
        if (request.FlowKind == ApsAuthFlowKind.ThreeLeggedConfidential &&
            cachedToken?.RefreshToken is { Length: > 0 } refreshToken) {
            var refreshedToken = TryRefreshTokenWithRaceProtection(
                cacheKey,
                clientSecret,
                refreshToken,
                cachedToken
            );

            if (refreshedToken != null)
                return CreateTokenResult(refreshedToken, request);
        }

        return request.FlowKind switch {
            ApsAuthFlowKind.TwoLegged =>
                PerformClientCredentialsFlow(clientId, clientSecret, cacheKey, request, scopes),
            ApsAuthFlowKind.ThreeLeggedConfidential =>
                PerformFullOAuthFlow(clientId, clientSecret, cacheKey, request, scopes),
            _ => throw new ArgumentOutOfRangeException(nameof(request.FlowKind), request.FlowKind, null)
        };
    }

    #region Full OAuth Flow

    /// <summary>
    ///     Performs the full 3-legged OAuth flow, opening browser for user consent.
    /// </summary>
    private static ApsTokenResult PerformFullOAuthFlow(
        string clientId,
        string? clientSecret,
        CacheKey cacheKey,
        ApsTokenRequest request,
        IReadOnlyList<string> scopes
    ) {
        if (string.IsNullOrEmpty(clientId))
            throw new ArgumentException("Client ID is required.", nameof(clientId));

        var tcs = new TaskCompletionSource<(ApsTokenResult? Result, Exception? Error)>();
        var clientIdPrefix = clientId[..Math.Min(8, clientId.Length)];

        Log.Information("[OAuth] Starting 3-legged OAuth flow for clientId: {ClientId}", clientIdPrefix + "...");

        OAuthHandler.Invoke3LeggedOAuth(clientId, clientSecret, scopes, token => {
            if (token == null) {
                Log.Warning("[OAuth] Callback received null token (authentication failed or was denied)");
                tcs.SetResult((
                    null,
                    new Exception(
                        "Authentication was denied or failed. Please try again. " +
                        "In the event of unexpected failure after 2 or 3 attempts, contact the developer."
                    )
                ));
                return;
            }

            try {
                var newCached = CreateCachedToken(token);
                UpdateCache(cacheKey, newCached);
                Log.Information("[OAuth] Callback recieved and token cached successfully");
                tcs.SetResult((CreateTokenResult(newCached, request), null));
            } catch (Exception ex) {
                Log.Error(ex, "[OAuth] Failed to cache token");
                tcs.SetResult((null, new Exception($"Failed to cache token: {ex.Message}", ex)));
            }
        });

        // Wait for callback with timeout to prevent infinite freeze
        var timeout = TimeSpan.FromMinutes(0.5);
        var completed = tcs.Task.Wait(timeout);

        if (!completed) {
            Log.Warning("[OAuth] Authentication timed out after {TimeoutSeconds}s", timeout.TotalSeconds);
            throw new TimeoutException(
                $"OAuth authentication timed out after {timeout.TotalSeconds} seconds. " +
                "The browser may have been closed or redirected to an error page. " +
                "Please try again. If the issue persists, check your APS credentials in Global settings.");
        }

        var (tokenResult, error) = tcs.Task.Result;
        if (error is not null) {
            Log.Error(error, "[OAuth] Authentication failed");
            throw error;
        }

        Log.Information("[OAuth] Authentication completed successfully");
        return tokenResult ?? throw new Exception("Access token is null");
    }

    #endregion

    #region Client Credentials

    private static ApsTokenResult PerformClientCredentialsFlow(
        string clientId,
        string? clientSecret,
        CacheKey cacheKey,
        ApsTokenRequest request,
        IReadOnlyList<string> scopes
    ) {
        if (string.IsNullOrWhiteSpace(clientSecret))
            throw new InvalidOperationException("A client secret is required for 2-legged APS authentication.");

        using var cts = new CancellationTokenSource(ClientCredentialsTimeout);
        var token = OAuthHandler
            .AcquireClientCredentialsTokenAsync(clientId, clientSecret, scopes, cts.Token)
            .ConfigureAwait(false)
            .GetAwaiter()
            .GetResult();

        var cachedToken = CreateCachedToken(token);
        UpdateCache(cacheKey, cachedToken);
        return CreateTokenResult(cachedToken, request);
    }

    #endregion

    #region Types

    /// <summary>Internal record for caching token data including refresh token</summary>
    private sealed record CachedToken(string AccessToken, string RefreshToken, DateTime ExpiresAt);

    private sealed record CacheKey(string ClientId, ApsAuthFlowKind FlowKind, string ScopeKey);

    #endregion

    #region Static Cache Infrastructure

    /// <summary>Cache of tokens keyed by client ID, shared across all OAuth instances</summary>
    private static readonly Dictionary<CacheKey, CachedToken> TokenCache = new();

    /// <summary>Lock for thread-safe cache access - kept minimal scope</summary>
    private static readonly object CacheLock = new();

    /// <summary>
    ///     Tracks which client IDs are currently being refreshed.
    ///     Prevents multiple threads from attempting simultaneous refreshes for the same client.
    /// </summary>
    private static readonly HashSet<CacheKey> RefreshInProgress = new();

    #endregion

    #region Configuration Constants

    /// <summary>Buffer time before expiration to trigger refresh (60 seconds)</summary>
    private const int ExpirationBufferSeconds = 60;

    /// <summary>Default token lifetime if server doesn't specify (1 hour)</summary>
    private const int DefaultExpirationSeconds = 3600;

    /// <summary>Timeout for token refresh HTTP requests</summary>
    private static readonly TimeSpan RefreshTimeout = TimeSpan.FromSeconds(10);

    private static readonly TimeSpan ClientCredentialsTimeout = TimeSpan.FromSeconds(15);

    #endregion

    #region Cache Operations

    /// <summary>
    ///     Reads the current cache state for a client ID.
    ///     Lock scope is minimal - just the dictionary read.
    /// </summary>
    /// <returns>Tuple of (cached token or null, whether refresh is needed)</returns>
    private static (CachedToken? Token, bool NeedsRefresh) ReadCacheState(CacheKey cacheKey) {
        lock (CacheLock) {
            if (!TokenCache.TryGetValue(cacheKey, out var cached))
                return (null, false);

            var needsRefresh = DateTime.UtcNow >= cached.ExpiresAt.AddSeconds(-ExpirationBufferSeconds);
            return (cached, needsRefresh);
        }
    }

    /// <summary>
    ///     Updates the cache with a new token. Lock scope is minimal - just the dictionary write.
    /// </summary>
    private static void UpdateCache(CacheKey cacheKey, CachedToken newToken) {
        lock (CacheLock) TokenCache[cacheKey] = newToken;
    }

    /// <summary>
    ///     Creates a CachedToken from an OAuthToken response.
    /// </summary>
    /// <param name="token">The OAuth token response</param>
    /// <param name="fallbackRefreshToken">Refresh token to use if response doesn't include one</param>
    private static CachedToken CreateCachedToken(OAuthToken token, string? fallbackRefreshToken = null) =>
        new(
            token.AccessToken!,
            token.RefreshToken ?? fallbackRefreshToken ?? "",
            DateTime.UtcNow.AddSeconds(token.ExpiresIn ?? DefaultExpirationSeconds)
        );

    private static ApsTokenResult CreateTokenResult(CachedToken token, ApsTokenRequest request) =>
        new(
            token.AccessToken,
            token.ExpiresAt,
            string.IsNullOrWhiteSpace(token.RefreshToken) ? null : token.RefreshToken,
            request.ScopeProfile,
            request.FlowKind
        );

    #endregion

    #region Token Refresh

    /// <summary>
    ///     Attempts to refresh the token with race condition protection.
    ///     If another thread is already refreshing this client's token, waits for that to complete.
    /// </summary>
    /// <returns>The refreshed cached token, or null if refresh failed</returns>
    private static CachedToken? TryRefreshTokenWithRaceProtection(
        CacheKey cacheKey,
        string? clientSecret,
        string refreshToken,
        CachedToken originalCached) {
        // Check if another thread is already refreshing this token
        lock (CacheLock) {
            if (RefreshInProgress.Contains(cacheKey)) {
                // Another thread is refreshing - wait for it and check cache again
                // This prevents N threads all hitting the API simultaneously
                return WaitForOtherRefreshAndCheckCache(cacheKey);
            }

            // Mark that we're starting a refresh
            _ = RefreshInProgress.Add(cacheKey);
        }

        try {
            var refreshedToken = ExecuteTokenRefresh(cacheKey.ClientId, clientSecret, refreshToken);
            if (refreshedToken == null)
                return null;

            var newCached = CreateCachedToken(refreshedToken, originalCached.RefreshToken);
            UpdateCache(cacheKey, newCached);
            return newCached;
        } finally {
            // Always clear the refresh-in-progress flag
            lock (CacheLock) _ = RefreshInProgress.Remove(cacheKey);
        }
    }

    /// <summary>
    ///     Waits briefly for another thread's refresh to complete, then checks the cache.
    /// </summary>
    private static CachedToken? WaitForOtherRefreshAndCheckCache(CacheKey cacheKey) {
        // Simple spin-wait with backoff - in practice, refresh takes ~100-500ms
        for (var i = 0; i < 50; i++) {
            Thread.Sleep(100); // 100ms * 50 = 5 second max wait

            lock (CacheLock) {
                if (!RefreshInProgress.Contains(cacheKey)) {
                    // Other thread finished - check if we got a fresh token
                    if (TokenCache.TryGetValue(cacheKey, out var cached) &&
                        DateTime.UtcNow < cached.ExpiresAt.AddSeconds(-ExpirationBufferSeconds))
                        return cached;

                    break; // Refresh finished but failed, we'll need to try ourselves or do full flow
                }
            }
        }

        return null;
    }

    /// <summary>
    ///     Executes the actual token refresh HTTP call synchronously.
    /// </summary>
    /// <remarks>
    ///     Uses <c>ConfigureAwait(false).GetAwaiter().GetResult()</c> pattern to avoid
    ///     deadlocks when called from UI synchronization contexts (common in Revit add-ins).
    /// </remarks>
    private static OAuthToken? ExecuteTokenRefresh(string clientId, string? clientSecret, string refreshToken) {
        try {
            using var cts = new CancellationTokenSource(RefreshTimeout);
            var task = OAuthHandler.RefreshTokenAsync(clientId, clientSecret, refreshToken, cts.Token);

            // ConfigureAwait(false) prevents SynchronizationContext capture, avoiding UI thread deadlocks
            return task.ConfigureAwait(false).GetAwaiter().GetResult();
        } catch (OperationCanceledException) {
            // TODO: update this to give feedback
            return null;
        } catch (Exception) {
            // TODO: update this to give feedback
            return null;
        }
    }

    #endregion
}