using Pe.Shared.ApsAuth;

namespace Pe.Aps.Auth;

public sealed class RefreshingApsTokenLease(
    Func<ApsTokenResult> acquireToken,
    TimeSpan? refreshBuffer = null,
    Func<DateTime>? utcNow = null
) {
    public static readonly TimeSpan DefaultRefreshBuffer = TimeSpan.FromMinutes(5);

    private readonly Func<ApsTokenResult> _acquireToken = acquireToken;
    private readonly TimeSpan _refreshBuffer = refreshBuffer ?? DefaultRefreshBuffer;
    private readonly Func<DateTime> _utcNow = utcNow ?? (() => DateTime.UtcNow);
    private ApsTokenResult? _current;

    public ApsTokenResult GetTokenResult() {
        if (this._current == null || this.ShouldRefresh(this._current))
            this._current = this._acquireToken();

        return this._current;
    }

    public string GetAccessToken() => this.GetTokenResult().AccessToken;

    internal bool ShouldRefresh(ApsTokenResult tokenResult) =>
        this._utcNow() >= tokenResult.ExpiresAtUtc.Subtract(this._refreshBuffer);
}
