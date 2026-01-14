using Pe.Global.Services.Aps.Models;

namespace Pe.Global.Services.Aps.Core;

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
    public string GetToken() {
        var clientId = this._tokenProvider.GetClientId();
        if (string.IsNullOrEmpty(clientId))
            throw new InvalidOperationException("ClientId is not set");

        var clientSecret = this._tokenProvider.GetClientSecret();

        // PHASE 1: Quick cache read under lock (fast path)
        var (cachedToken, needsRefresh) = ReadCacheState(clientId);
        if (cachedToken != null && !needsRefresh)
            return cachedToken.AccessToken;

        // PHASE 2: Attempt token refresh outside lock (slow path, no blocking)
        if (cachedToken?.RefreshToken is { Length: > 0 } refreshToken) {
            var refreshResult = TryRefreshTokenWithRaceProtection(clientId, clientSecret, refreshToken, cachedToken);
            if (refreshResult != null)
                return refreshResult;
        }

        // PHASE 3: Full OAuth flow (user interaction required)
        return this.PerformFullOAuthFlow(clientId, clientSecret);
    }

    #region Full OAuth Flow

    /// <summary>
    ///     Performs the full 3-legged OAuth flow, opening browser for user consent.
    /// </summary>
    private string PerformFullOAuthFlow(string clientId, string clientSecret) {
        var tcs = new TaskCompletionSource<Result<string>>();

        OAuthHandler.Invoke3LeggedOAuth(clientId, clientSecret, token => {
            if (token == null) {
                tcs.SetResult(new Exception(
                    "Authentication was denied or failed. Please try again. " +
                    "In the event of unexpected failure after 2 or 3 attempts, contact the developer."));
                return;
            }

            try {
                var newCached = CreateCachedToken(token);
                UpdateCache(clientId, newCached);
                // AccessToken is required in OAuthToken, guaranteed non-null
                tcs.SetResult(token.AccessToken!);
            } catch (Exception ex) {
                tcs.SetResult(new Exception($"Failed to cache token: {ex.Message}"));
            }
        });

        // Wait for callback - this is intentional blocking as we need the token before returning
        tcs.Task.Wait();

        var (accessToken, error) = tcs.Task.Result;
        return error is not null ? throw error : accessToken;
    }

    #endregion

    #region Types

    /// <summary>Internal record for caching token data including refresh token</summary>
    private sealed record CachedToken(string AccessToken, string RefreshToken, DateTime ExpiresAt);

    #endregion

    #region Static Cache Infrastructure

    /// <summary>Cache of tokens keyed by client ID, shared across all OAuth instances</summary>
    private static readonly Dictionary<string, CachedToken> TokenCache = new();

    /// <summary>Lock for thread-safe cache access - kept minimal scope</summary>
    private static readonly object CacheLock = new();

    /// <summary>
    ///     Tracks which client IDs are currently being refreshed.
    ///     Prevents multiple threads from attempting simultaneous refreshes for the same client.
    /// </summary>
    private static readonly HashSet<string> RefreshInProgress = new();

    #endregion

    #region Configuration Constants

    /// <summary>Buffer time before expiration to trigger refresh (60 seconds)</summary>
    private const int ExpirationBufferSeconds = 60;

    /// <summary>Default token lifetime if server doesn't specify (1 hour)</summary>
    private const int DefaultExpirationSeconds = 3600;

    /// <summary>Timeout for token refresh HTTP requests</summary>
    private static readonly TimeSpan RefreshTimeout = TimeSpan.FromSeconds(10);

    #endregion

    #region Cache Operations

    /// <summary>
    ///     Reads the current cache state for a client ID.
    ///     Lock scope is minimal - just the dictionary read.
    /// </summary>
    /// <returns>Tuple of (cached token or null, whether refresh is needed)</returns>
    private static (CachedToken? Token, bool NeedsRefresh) ReadCacheState(string clientId) {
        lock (CacheLock) {
            if (!TokenCache.TryGetValue(clientId, out var cached))
                return (null, false);

            var needsRefresh = DateTime.UtcNow >= cached.ExpiresAt.AddSeconds(-ExpirationBufferSeconds);
            return (cached, needsRefresh);
        }
    }

    /// <summary>
    ///     Updates the cache with a new token. Lock scope is minimal - just the dictionary write.
    /// </summary>
    private static void UpdateCache(string clientId, CachedToken newToken) {
        lock (CacheLock) TokenCache[clientId] = newToken;
    }

    /// <summary>
    ///     Creates a CachedToken from an OAuthToken response.
    /// </summary>
    /// <param name="token">The OAuth token response</param>
    /// <param name="fallbackRefreshToken">Refresh token to use if response doesn't include one</param>
    private static CachedToken CreateCachedToken(OAuthToken token, string? fallbackRefreshToken = null) =>
        new(
            // AccessToken and RefreshToken are required in OAuthToken, guaranteed non-null
            token.AccessToken!,
            token.RefreshToken ?? fallbackRefreshToken ?? "",
            DateTime.UtcNow.AddSeconds(token.ExpiresIn ?? DefaultExpirationSeconds)
        );

    #endregion

    #region Token Refresh

    /// <summary>
    ///     Attempts to refresh the token with race condition protection.
    ///     If another thread is already refreshing this client's token, waits for that to complete.
    /// </summary>
    /// <returns>The new access token, or null if refresh failed</returns>
    private static string? TryRefreshTokenWithRaceProtection(
        string clientId,
        string? clientSecret,
        string refreshToken,
        CachedToken originalCached) {
        // Check if another thread is already refreshing this token
        lock (CacheLock) {
            if (RefreshInProgress.Contains(clientId)) {
                // Another thread is refreshing - wait for it and check cache again
                // This prevents N threads all hitting the API simultaneously
                return WaitForOtherRefreshAndCheckCache(clientId);
            }

            // Mark that we're starting a refresh
            _ = RefreshInProgress.Add(clientId);
        }

        try {
            var refreshedToken = ExecuteTokenRefresh(clientId, clientSecret, refreshToken);
            if (refreshedToken == null)
                return null;

            var newCached = CreateCachedToken(refreshedToken, originalCached.RefreshToken);
            UpdateCache(clientId, newCached);
            return newCached.AccessToken;
        } finally {
            // Always clear the refresh-in-progress flag
            lock (CacheLock) _ = RefreshInProgress.Remove(clientId);
        }
    }

    /// <summary>
    ///     Waits briefly for another thread's refresh to complete, then checks the cache.
    /// </summary>
    private static string? WaitForOtherRefreshAndCheckCache(string clientId) {
        // Simple spin-wait with backoff - in practice, refresh takes ~100-500ms
        for (var i = 0; i < 50; i++) {
            Thread.Sleep(100); // 100ms * 50 = 5 second max wait

            lock (CacheLock) {
                if (!RefreshInProgress.Contains(clientId)) {
                    // Other thread finished - check if we got a fresh token
                    if (TokenCache.TryGetValue(clientId, out var cached) &&
                        DateTime.UtcNow < cached.ExpiresAt.AddSeconds(-ExpirationBufferSeconds))
                        return cached.AccessToken;
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
        // Client secret is required for token refresh
        if (string.IsNullOrEmpty(clientSecret))
            return null;

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