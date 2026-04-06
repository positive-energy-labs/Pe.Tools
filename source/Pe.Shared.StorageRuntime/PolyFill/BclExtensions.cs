namespace Pe.Shared.StorageRuntime.PolyFill;

/// <summary>
///     Polyfill extension methods to provide modern BCL APIs across .NET Framework and .NET versions.
/// </summary>
public static class BclExtensions {
    private const int TrimEntriesFlag = 2;

    public static string GetRelativePath(string relativeTo, string path) {
        relativeTo = Path.GetFullPath(relativeTo);
        path = Path.GetFullPath(path);

        var separators = new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar };
        var relativeToSegments = relativeTo.Split(separators);
        var pathSegments = path.Split(separators);

        var commonLength = 0;
        var minLength = Math.Min(relativeToSegments.Length, pathSegments.Length);
        for (var i = 0; i < minLength; i++) {
            if (!string.Equals(relativeToSegments[i], pathSegments[i], StringComparison.OrdinalIgnoreCase))
                break;

            commonLength++;
        }

        if (commonLength == 0)
            return path;

        var relativePath = string.Join(
            Path.DirectorySeparatorChar.ToString(),
            Enumerable.Repeat("..", relativeToSegments.Length - commonLength)
                .Concat(pathSegments.Skip(commonLength))
        );

        return string.IsNullOrEmpty(relativePath) ? "." : relativePath;
    }

    public static bool TryAdd<TKey, TValue>(this Dictionary<TKey, TValue> dictionary, TKey key, TValue value) {
#if NET48
        if (dictionary.ContainsKey(key))
            return false;

        dictionary[key] = value;
        return true;
#else
        return dictionary.TryAdd(key, value);
#endif
    }

    public static TValue? GetValueOrDefault<TKey, TValue>(this Dictionary<TKey, TValue> dictionary, TKey key) =>
        dictionary.TryGetValue(key, out var value) ? value : default;

    public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, TValue> kvp, out TKey key, out TValue value) {
        key = kvp.Key;
        value = kvp.Value;
    }

    public static int Clamp(int value, int min, int max) {
        if (min > max)
            throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");

        if (value < min)
            return min;
        if (value > max)
            return max;

        return value;
    }

    public static double Clamp(double value, double min, double max) {
        if (min > max)
            throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");

        if (value < min)
            return min;
        if (value > max)
            return max;

        return value;
    }

    public static string[] SplitAndTrim(this string value,
        char separator,
        StringSplitOptions options = StringSplitOptions.None) {
        var frameworkOptions = NormalizeSplitOptions(options);
        var parts = value.Split(new[] { separator }, frameworkOptions);
        return FinalizeSplitParts(parts, options);
    }

    public static string[] SplitAndTrim(
        this string value,
        char[] separators,
        StringSplitOptions options = StringSplitOptions.None
    ) {
        var frameworkOptions = NormalizeSplitOptions(options);
        var parts = value.Split(separators, frameworkOptions);
        return FinalizeSplitParts(parts, options);
    }

    public static string JoinWith(this IEnumerable<string> values, char separator) =>
        string.Join(separator.ToString(), values);

    public static string JoinWith(this IEnumerable<string> values, string separator) =>
        string.Join(separator, values);

    private static StringSplitOptions NormalizeSplitOptions(StringSplitOptions options) =>
        (StringSplitOptions)((int)options & ~TrimEntriesFlag);

    private static string[] FinalizeSplitParts(string[] parts, StringSplitOptions options) {
        var shouldTrim = ((int)options & TrimEntriesFlag) == TrimEntriesFlag;
        if (shouldTrim) {
            for (var i = 0; i < parts.Length; i++)
                parts[i] = parts[i].Trim();
        }

        if ((options & StringSplitOptions.RemoveEmptyEntries) != 0)
            return parts.Where(part => !string.IsNullOrEmpty(part)).ToArray();

        return parts;
    }
}