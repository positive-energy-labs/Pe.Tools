using Newtonsoft.Json.Linq;
using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Expands $include directives in JSON arrays by resolving fragment files.
///     Fragment files must be JSON objects with an "Items" array property.
/// </summary>
public static class JsonArrayComposer {
    /// <summary>
    ///     Expands all $include directives in the JSON tree, replacing include objects
    ///     with the contents of the referenced fragment files.
    /// </summary>
    public static JObject ExpandIncludes(JObject root, string includeRootDirectory) =>
        ExpandIncludes(root, includeRootDirectory, null, null, null);

    public static JObject ExpandIncludes(
        JObject root,
        string includeRootDirectory,
        IEnumerable<string>? allowedRoots = null,
        Action<string, string>? onFragmentResolved = null,
        string? globalFragmentsDirectory = null
    ) {
        var normalizedIncludeRootDirectory = Path.GetFullPath(includeRootDirectory);
        var normalizedGlobalFragmentsDirectory = string.IsNullOrWhiteSpace(globalFragmentsDirectory)
            ? null
            : Path.GetFullPath(globalFragmentsDirectory);
        var normalizedAllowedRoots = SettingsPathing.NormalizeAllowedRoots(allowedRoots);
        var visitedFragments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void ExpandToken(JToken token) {
            switch (token) {
                case JObject obj:
                    foreach (var property in obj.Properties().ToList())
                        ExpandToken(property.Value);
                    break;
                case JArray array:
                    ExpandArray(array);
                    break;
            }
        }

        void ExpandArray(JArray array) {
            var i = 0;
            while (i < array.Count) {
                var item = array[i];
                if (item is JObject obj && obj.TryGetValue("$include", out var includeToken)) {
                    var (originalPath, resolvedDirective) = ResolveInclude(includeToken);
                    var fragmentPath = ResolveFragmentPath(resolvedDirective);

                    if (visitedFragments.Contains(fragmentPath))
                        throw JsonCompositionException.CircularFragmentInclude(fragmentPath, [.. visitedFragments, fragmentPath]);

                    var fragmentItems = LoadFragmentItems(fragmentPath, originalPath);
                    array.RemoveAt(i);
                    foreach (var fragmentItem in fragmentItems) {
                        array.Insert(i, fragmentItem);
                        i++;
                    }
                    continue;
                }

                ExpandToken(item);
                i++;
            }
        }

        (string originalPath, SettingsPathing.ResolvedDirective resolvedDirective) ResolveInclude(JToken includeToken) {
            if (includeToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(includeToken.Value<string>()))
                throw JsonCompositionException.InvalidIncludeValue(includeToken.Type.ToString());

            var originalPath = includeToken.Value<string>()!;
            try {
                var resolvedDirective = SettingsPathing.ResolveDirectivePath(
                    originalPath,
                    normalizedIncludeRootDirectory,
                    normalizedGlobalFragmentsDirectory,
                    normalizedAllowedRoots,
                    nameof(includeToken),
                    requireGlobalAllowedRoot: true
                );
                return (originalPath, resolvedDirective);
            } catch (ArgumentException) {
                throw JsonCompositionException.InvalidIncludePath(originalPath, normalizedAllowedRoots);
            }
        }

        List<JToken> LoadFragmentItems(string fragmentPath, string includePath) {
            try {
                _ = visitedFragments.Add(fragmentPath);

                var content = File.ReadAllText(fragmentPath);
                var items = fragmentPath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase)
                    ? ParseToonToJArray(content)
                    : ParseJsonFragmentItems(fragmentPath, content);

                onFragmentResolved?.Invoke(fragmentPath, includePath);
                foreach (var item in items)
                    ExpandToken(item);

                return items.Select(item => item.DeepClone()).ToList();
            } catch (JsonCompositionException) {
                throw;
            } catch (Exception ex) {
                throw JsonCompositionException.FragmentLoadFailed(fragmentPath, ex);
            } finally {
                _ = visitedFragments.Remove(fragmentPath);
            }
        }

        ExpandToken(root);
        return root;
    }

    private static JArray ParseJsonFragmentItems(string fragmentPath, string jsonContent) {
        var parsed = JToken.Parse(jsonContent);
        return parsed switch {
            JArray arr => arr,
            JObject obj when obj.TryGetValue("Items", out var itemsToken) && itemsToken is JArray arr => arr,
            _ => throw JsonCompositionException.InvalidFragmentFormat(fragmentPath, parsed.Type.ToString())
        };
    }

    private static string ResolveFragmentPath(SettingsPathing.ResolvedDirective directive) {
        var candidates = SettingsPathing.ResolveDirectiveFileCandidates(directive, allowToonFallback: true);
        if (File.Exists(candidates.JsonPath))
            return candidates.JsonPath;
        if (!string.IsNullOrWhiteSpace(candidates.ToonPath) && File.Exists(candidates.ToonPath))
            return candidates.ToonPath;
        throw JsonCompositionException.FragmentNotFound(candidates.JsonPath);
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
}
