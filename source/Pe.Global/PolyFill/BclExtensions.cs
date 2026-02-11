namespace Pe.Global.PolyFill;

/// <summary>
///     Polyfill extension methods to provide modern BCL APIs across .NET Framework and .NET versions.
///     These methods abstract framework-specific differences in the Base Class Library.
/// </summary>
public static class BclExtensions {
        /// <summary>
        ///     Gets a relative path from one path to another.
        ///     Polyfill for Path.GetRelativePath (added in .NET Core 2.0).
        /// </summary>
        public static string GetRelativePath(string relativeTo, string path) {
#if NET48
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
#else
                return BclExtensions.GetRelativePath(relativeTo, path);
#endif
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
                return dictionary.GetValueOrDefault(key);
#endif
        }

        /// <summary>
        ///     Gets the value associated with the specified key, or the specified default value if the key is not present.
        ///     Polyfill for Dictionary.GetValueOrDefault (added in .NET Core 2.0).
        /// </summary>
        public static TValue GetValueOrDefault<TKey, TValue>(this Dictionary<TKey, TValue> dictionary, TKey key, TValue defaultValue) {
#if NET48
        return dictionary.TryGetValue(key, out var value) ? value : defaultValue;
#else
                return dictionary.GetValueOrDefault(key, defaultValue);
#endif
        }

        /// <summary>
        ///     Deconstructs a KeyValuePair into separate key and value variables.
        ///     Polyfill for KeyValuePair.Deconstruct (added in C# 7.0 / .NET Core 2.0).
        /// </summary>
        public static void Deconstruct<TKey, TValue>(this KeyValuePair<TKey, TValue> kvp, out TKey key, out TValue value) {
#if NET48
        key = kvp.Key;
        value = kvp.Value;
#else
                kvp.Deconstruct(out key, out value);
#endif
        }

        /// <summary>
        ///     Clamps a value between a minimum and maximum value.
        ///     Polyfill for Math.Clamp (added in .NET Core 2.0).
        /// </summary>
        public static int Clamp(int value, int min, int max) {
#if NET48
        if (min > max) throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");
        if (value < min) return min;
        if (value > max) return max;
        return value;
#else
                return BclExtensions.Clamp(value, min, max);
#endif
        }

        /// <summary>
        ///     Clamps a value between a minimum and maximum value.
        ///     Polyfill for Math.Clamp (added in .NET Core 2.0).
        /// </summary>
        public static double Clamp(double value, double min, double max) {
#if NET48
        if (min > max) throw new ArgumentException($"min ({min}) must be less than or equal to max ({max})");
        if (value < min) return min;
        if (value > max) return max;
        return value;
#else
                return BclExtensions.Clamp(value, min, max);
#endif
        }
}
