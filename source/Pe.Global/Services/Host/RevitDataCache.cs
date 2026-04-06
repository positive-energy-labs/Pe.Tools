using Pe.Host.Contracts.Protocol;
using System.Collections.Concurrent;

namespace Pe.Global.Services.Host;

internal sealed class RevitDataCache {
    private readonly ConcurrentDictionary<CacheKey, CacheEntry> _entries = new();
    private readonly ConcurrentDictionary<HostInvalidationDomain, long> _generations = new();
    private readonly ConcurrentDictionary<CacheKey, Lazy<Task<object>>> _inflight = new();

    public async Task<TValue> GetOrCreateAsync<TValue>(
        HostInvalidationDomain domain,
        string key,
        TimeSpan ttl,
        Func<Task<TValue>> factory
    ) {
        var generation = this.GetCurrentGeneration(domain);
        var cacheKey = new CacheKey(domain, generation, key);
        if (this._entries.TryGetValue(cacheKey, out var cachedEntry) &&
            cachedEntry.ExpiresUtc > DateTime.UtcNow &&
            cachedEntry.Value is TValue cachedValue)
            return cachedValue;

        var createdValue = await this.CoalesceAsync(domain, generation, key, factory);
        if (this.GetCurrentGeneration(domain) == generation)
            this._entries[cacheKey] = new CacheEntry(createdValue!, DateTime.UtcNow.Add(ttl));

        return createdValue;
    }

    public async Task<TValue> CoalesceAsync<TValue>(
        HostInvalidationDomain domain,
        string key,
        Func<Task<TValue>> factory
    ) => await this.CoalesceAsync(domain, this.GetCurrentGeneration(domain), key, factory);

    private async Task<TValue> CoalesceAsync<TValue>(
        HostInvalidationDomain domain,
        long generation,
        string key,
        Func<Task<TValue>> factory
    ) {
        var cacheKey = new CacheKey(domain, generation, key);
        var lazyTask = this._inflight.GetOrAdd(cacheKey, _ =>
            new Lazy<Task<object>>(async () => (await factory())!));

        try {
            var result = await lazyTask.Value;
            return (TValue)result;
        } finally {
            if (lazyTask.IsValueCreated && lazyTask.Value.IsCompleted)
                _ = this._inflight.TryRemove(cacheKey, out _);
        }
    }

    public void Invalidate(params HostInvalidationDomain[] domains) {
        if (domains.Length == 0) {
            this._entries.Clear();
            this._inflight.Clear();
            foreach (var domain in Enum.GetValues(typeof(HostInvalidationDomain)).Cast<HostInvalidationDomain>())
                this.AdvanceGeneration(domain);

            return;
        }

        var domainSet = domains.ToHashSet();
        foreach (var domain in domainSet)
            this.AdvanceGeneration(domain);

        foreach (var entry in this._entries.Keys.Where(key => domainSet.Contains(key.Domain)).ToList())
            _ = this._entries.TryRemove(entry, out _);

        foreach (var inflight in this._inflight.Keys.Where(key => domainSet.Contains(key.Domain)).ToList())
            _ = this._inflight.TryRemove(inflight, out _);
    }

    private long GetCurrentGeneration(HostInvalidationDomain domain) =>
        this._generations.TryGetValue(domain, out var generation) ? generation : 0;

    private void AdvanceGeneration(HostInvalidationDomain domain) =>
        _ = this._generations.AddOrUpdate(domain, 1, (_, current) => current + 1);

    private sealed record CacheEntry(
        object Value,
        DateTime ExpiresUtc
    );

    private readonly record struct CacheKey(
        HostInvalidationDomain Domain,
        long Generation,
        string RequestKey
    );
}