namespace Pe.Revit.Global.PolyFill;

/// <summary>
///     Polyfill extension methods to provide modern BCL APIs across .NET Framework and .NET versions.
///     These methods abstract framework-specific differences in the Base Class Library.
/// </summary>
public static class BclExtensions {
    private const int TrimEntriesFlag = 2;

    /// <summary>
    ///     Gets a relative path from one path to another.
    ///     Polyfill for Path.GetRelativePath (added in .NET Core 2.0).
    /// </summary>
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

    /// <summary>
    ///     Attempts to add the specified key and value to the dictionary.
    ///     Polyfill for Dictionary.TryAdd (added in .NET Core 2.0).
    /// </summary>
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

    /// <summary>
    ///     Gets the value associated with the specified key, or a default value if the key is not present.
    ///     Polyfill for Dictionary.GetValueOrDefault (added in .NET Core 2.0).
    /// </summary>
    public static TValue? GetValueOrDefault<TKey, TValue>(this Dictionary<TKey, TValue> dictionary, TKey key) {
#if NET48
        return dictionary.TryGetValue(key, out var value) ? value : default;
#else
        return dictionary.TryGetValue(key, out var value) ? value : default;
#endif
    }

    /// <summary>
    ///     Deconstructs a KeyValuePair into separate key and value variables.
    ///     Polyfill for KeyValuePair.Deconstruct (added in C# 7.0 / .NET Core 2.0).
    /// </summary>
    public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, TValue> kvp, out TKey key, out TValue value) {
        key = kvp.Key;
        value = kvp.Value;
    }

    /// <summary>
    ///     Reads HTTP content as a string with a framework-agnostic API surface.
    ///     .NET Framework does not expose the cancellation-token overload.
    /// </summary>
    public static Task<string> ReadAsStringAsyncCompat(this HttpContent content, CancellationToken cancellationToken) {
#if NET48
        return content.ReadAsStringAsync();
#else
        return content.ReadAsStringAsync(cancellationToken);
#endif
    }

    /// <summary>
    ///     Clamps a value between a minimum and maximum value.
    ///     Polyfill for Math.Clamp (added in .NET Core 2.0).
    /// </summary>
    public static int Clamp(int value, int min, int max) {
        if (min > max) throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    /// <summary>
    ///     Clamps a value between a minimum and maximum value.
    ///     Polyfill for Math.Clamp (added in .NET Core 2.0).
    /// </summary>
    public static double Clamp(double value, double min, double max) {
        if (min > max) throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");
        if (value < min) return min;
        if (value > max) return max;
        return value;
    }

    /// <summary>
    ///     Splits a string with options including TrimEntries support.
    ///     Polyfill for StringSplitOptions.TrimEntries (added in .NET 5).
    /// </summary>
    public static string[] SplitAndTrim(this string value, char separator, StringSplitOptions options = StringSplitOptions.None) {
        var frameworkOptions = NormalizeSplitOptions(options);
        var parts = value.Split(new[] { separator }, frameworkOptions);
        return FinalizeSplitParts(parts, options);
    }

    /// <summary>
    ///     Splits a string with options including TrimEntries support.
    ///     Polyfill for StringSplitOptions.TrimEntries (added in .NET 5).
    /// </summary>
    public static string[] SplitAndTrim(this string value, char[] separators, StringSplitOptions options = StringSplitOptions.None) {
        var frameworkOptions = NormalizeSplitOptions(options);
        var parts = value.Split(separators, frameworkOptions);
        return FinalizeSplitParts(parts, options);
    }

    /// <summary>
    ///     Joins strings with a character separator.
    ///     Polyfill for string.Join(char, IEnumerable) (added in .NET Core).
    /// </summary>
    public static string JoinWith(this IEnumerable<string> values, char separator) {
        return string.Join(separator.ToString(), values);
    }

    /// <summary>
    ///     Joins strings with a string separator.
    ///     Framework-agnostic wrapper around string.Join.
    /// </summary>
    public static string JoinWith(this IEnumerable<string> values, string separator) {
        return string.Join(separator, values);
    }

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
