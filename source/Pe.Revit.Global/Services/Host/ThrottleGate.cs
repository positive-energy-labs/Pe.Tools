using System.Collections.Concurrent;

namespace Pe.Revit.Global.Services.Host;

public enum ThrottleDecision {
    Executed,
    CacheHit,
    Coalesced
}

public class ThrottleGate {
    private readonly ConcurrentDictionary<string, CachedEntry> _cache = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, Lazy<Task<object?>>> _inFlight = new(StringComparer.Ordinal);

    public async Task<(T Result, ThrottleDecision Decision)> ExecuteAsync<T>(
        string key,
        TimeSpan cacheWindow,
        Func<Task<T>> factory
    ) {
        var now = DateTimeOffset.UtcNow;
        if (this._cache.TryGetValue(key, out var cached) && cached.ExpiresAt > now)
            return ((T)cached.Value!, ThrottleDecision.CacheHit);

        var created = false;
        var candidate = new Lazy<Task<object?>>(async () => {
            try {
                var value = await factory();
                this._cache[key] = new CachedEntry(value, DateTimeOffset.UtcNow.Add(cacheWindow));
                return value;
            } finally {
                _ = this._inFlight.TryRemove(key, out _);
            }
        });

        var lazy = this._inFlight.GetOrAdd(key, _ => {
            created = true;
            return candidate;
        });

        var result = await lazy.Value;
        var decision = created ? ThrottleDecision.Executed : ThrottleDecision.Coalesced;
        return ((T)result!, decision);
    }

    private sealed record CachedEntry(object? Value, DateTimeOffset ExpiresAt);
}
