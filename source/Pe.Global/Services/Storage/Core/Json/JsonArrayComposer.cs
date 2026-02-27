using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Expands $include directives in JSON arrays by resolving fragment files.
///     Fragment files must be JSON objects with an "Items" array property.
/// </summary>
public static class JsonArrayComposer {
    private static readonly AsyncLocal<bool> _toonIncludesEnabled = new();

    /// <summary>
    ///     Expands all $include directives in the JSON tree, replacing include objects
    ///     with the contents of the referenced fragment files.
    /// </summary>
    public static void ExpandIncludes(JObject root, string baseDir) =>
        ExpandIncludes(root, baseDir, baseDir, []);

    public static void ExpandIncludes(
        JObject root,
        string baseDir,
        string includeRootDirectory,
        IEnumerable<string> allowedRoots,
        Action<string, string>? onFragmentResolved = null
    ) {
        var normalizedIncludeRootDirectory = Path.GetFullPath(includeRootDirectory);
        SettingsPathing.EnsurePathUnderRoot(baseDir, normalizedIncludeRootDirectory, nameof(baseDir));
        var normalizedAllowedRoots = allowedRoots
            .Where(rootName => !string.IsNullOrWhiteSpace(rootName))
            .Select(rootName => rootName.Replace('\\', '/').Trim('/'))
            .Where(rootName => !string.IsNullOrWhiteSpace(rootName))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        ExpandIncludes(root, normalizedIncludeRootDirectory, normalizedAllowedRoots, [], onFragmentResolved);
    }

    private static void ExpandIncludes(
        JToken token,
        string includeRootDirectory,
        HashSet<string> allowedRoots,
        HashSet<string> visitedFragments,
        Action<string, string>? onFragmentResolved
    ) {
        switch (token) {
            case JObject obj:
                foreach (var property in obj.Properties().ToList())
                    ExpandIncludes(property.Value, includeRootDirectory, allowedRoots, visitedFragments, onFragmentResolved);
                break;
            case JArray array:
                ExpandArrayIncludes(array, includeRootDirectory, allowedRoots, visitedFragments, onFragmentResolved);
                break;
        }
    }

    private static void ExpandArrayIncludes(
        JArray array,
        string includeRootDirectory,
        HashSet<string> allowedRoots,
        HashSet<string> visitedFragments,
        Action<string, string>? onFragmentResolved
    ) {
        var i = 0;
        while (i < array.Count) {
            var item = array[i];
            if (item is JObject obj && obj.TryGetValue("$include", out var includeToken)) {
                var includePath = ValidateAndGetIncludePath(includeToken, allowedRoots);
                var fragmentPath = ResolveFragmentPath(includeRootDirectory, includePath);
                
                if (visitedFragments.Contains(fragmentPath))
                    throw JsonCompositionException.CircularFragmentInclude(fragmentPath, [.. visitedFragments, fragmentPath]);

                var fragmentItems = LoadFragmentItems(
                    fragmentPath,
                    includePath,
                    includeRootDirectory,
                    allowedRoots,
                    visitedFragments,
                    onFragmentResolved
                );
                
                array.RemoveAt(i);
                foreach (var fragmentItem in fragmentItems) {
                    array.Insert(i, fragmentItem);
                    i++;
                }
            } else {
                ExpandIncludes(item, includeRootDirectory, allowedRoots, visitedFragments, onFragmentResolved);
                i++;
            }
        }
    }

    private static string ValidateAndGetIncludePath(JToken includeToken, HashSet<string> allowedRoots) {
        if (includeToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(includeToken.Value<string>()))
            throw JsonCompositionException.InvalidIncludeValue(includeToken.Type.ToString());

        var includePath = includeToken.Value<string>()!;
        
        if (includePath.Contains("..") || includePath.Contains("./") || Path.IsPathRooted(includePath))
            throw JsonCompositionException.InvalidIncludePath(includePath);

        var segments = includePath.Replace('\\', '/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            throw JsonCompositionException.InvalidIncludePath(includePath);

        // Backward-compatible behavior: when no roots are specified (e.g., 2-arg overload),
        // allow includes as long as path safety checks pass.
        if (allowedRoots.Count != 0 && !allowedRoots.Contains(segments[0]))
            throw JsonCompositionException.InvalidIncludePath(includePath);

        return includePath;
    }

    private static string ResolveFragmentPath(string includeRootDirectory, string includePath) {
        var normalizedPath = includePath.Replace('/', Path.DirectorySeparatorChar);
        var hasJsonExtension = includePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
        var hasToonExtension = includePath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase);
        var jsonPath = hasJsonExtension
            ? Path.GetFullPath(Path.Combine(includeRootDirectory, normalizedPath))
            : Path.GetFullPath(Path.Combine(includeRootDirectory, normalizedPath + ".json"));
        SettingsPathing.EnsurePathUnderRoot(jsonPath, includeRootDirectory, nameof(includePath));
        
        if (File.Exists(jsonPath))
            return jsonPath;

        if (_toonIncludesEnabled.Value && !hasJsonExtension) {
            var toonPath = hasToonExtension
                ? Path.GetFullPath(Path.Combine(includeRootDirectory, normalizedPath))
                : Path.GetFullPath(Path.Combine(includeRootDirectory, normalizedPath + ".toon"));
            SettingsPathing.EnsurePathUnderRoot(toonPath, includeRootDirectory, nameof(includePath));
            if (File.Exists(toonPath))
                return toonPath;
        }

        throw JsonCompositionException.FragmentNotFound(jsonPath);
    }

    private static List<JToken> LoadFragmentItems(
        string fragmentPath,
        string includePath,
        string includeRootDirectory,
        HashSet<string> allowedRoots,
        HashSet<string> visitedFragments,
        Action<string, string>? onFragmentResolved
    ) {
        try {
            _ = visitedFragments.Add(fragmentPath);
            
            string content;
            JArray items;
            
            if (fragmentPath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase)) {
                content = File.ReadAllText(fragmentPath);
                items = ParseToonToJArray(content);
            } else {
                content = File.ReadAllText(fragmentPath);
                var parsed = JToken.Parse(content);
                
                items = parsed switch {
                    JArray arr => arr,
                    JObject obj when obj.TryGetValue("Items", out var itemsToken) && itemsToken is JArray arr => arr,
                    _ => throw JsonCompositionException.InvalidFragmentFormat(fragmentPath, parsed.Type.ToString())
                };
            }

            onFragmentResolved?.Invoke(fragmentPath, includePath);

            foreach (var item in items)
                ExpandIncludes(item, includeRootDirectory, allowedRoots, visitedFragments, onFragmentResolved);

            return items.Select(item => item.DeepClone()).ToList();
        } catch (JsonCompositionException) {
            throw;
        } catch (Exception ex) {
            throw JsonCompositionException.FragmentLoadFailed(fragmentPath, ex);
        } finally {
            _ = visitedFragments.Remove(fragmentPath);
        }
    }

    private static JArray ParseToonToJArray(string toonContent) {
        var result = new JArray();
        var lines = toonContent.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        
        if (lines.Length == 0)
            return result;

        var headerLine = lines[0].Trim();
        if (!headerLine.Contains('[') || !headerLine.Contains('{'))
            throw new InvalidOperationException($"Invalid toon header: {headerLine}");

        var braceStart = headerLine.IndexOf('{');
        var braceEnd = headerLine.IndexOf('}');
        
        var fieldNames = headerLine[(braceStart + 1)..braceEnd]
            .Split(',')
            .Select(f => f.Trim())
            .ToArray();

        for (var i = 1; i < lines.Length; i++) {
            var dataLine = lines[i].Trim();
            if (string.IsNullOrWhiteSpace(dataLine))
                continue;

            var values = dataLine.Split(',').Select(v => v.Trim()).ToArray();
            var obj = new JObject();
            
            for (var j = 0; j < Math.Min(fieldNames.Length, values.Length); j++)
                obj[fieldNames[j]] = values[j];

            result.Add(obj);
        }

        return result;
    }

    /// <summary>
    ///     Creates a scope that enables .toon file resolution for $include directives.
    /// </summary>
    public static IDisposable EnableToonIncludesScope(bool enabled) {
        var previous = _toonIncludesEnabled.Value;
        _toonIncludesEnabled.Value = enabled;
        return new DisposeAction(() => _toonIncludesEnabled.Value = previous);
    }

    private sealed class DisposeAction(Action action) : IDisposable {
        public void Dispose() => action();
    }
}
