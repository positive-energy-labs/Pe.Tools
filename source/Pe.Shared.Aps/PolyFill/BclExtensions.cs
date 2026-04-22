namespace Pe.Shared.Aps.PolyFill;

internal static class BclExtensions {
    public static async Task<string> ReadAsStringAsyncCompat(
        this HttpContent content,
        CancellationToken cancellationToken
    ) {
        if (content == null)
            throw new ArgumentNullException(nameof(content));

        cancellationToken.ThrowIfCancellationRequested();
        return await content.ReadAsStringAsync().ConfigureAwait(false);
    }

    public static void Deconstruct<TKey, TValue>(
        this KeyValuePair<TKey, TValue> pair,
        out TKey key,
        out TValue value
    ) {
        key = pair.Key;
        value = pair.Value;
    }

    public static TValue? GetValueOrDefault<TKey, TValue>(
        this IReadOnlyDictionary<TKey, TValue> dictionary,
        TKey key
    ) {
        if (dictionary == null)
            throw new ArgumentNullException(nameof(dictionary));

        return dictionary.TryGetValue(key, out var value) ? value : default;
    }
}