using Newtonsoft.Json;
using Pe.Global.PolyFill;
using Newtonsoft.Json.Linq;
#if NET8_0_OR_GREATER
using Toon;
#endif

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Utility for composing JSON arrays from reusable fragment files.
///     Processes <c>$include</c> directives within arrays, replacing them with fragment contents.
/// </summary>
/// <remarks>
///     <para>Usage in JSON:</para>
///     <code>
///     {
///       "Fields": [
///         { "$include": "_fragments/header-fields" },
///         { "ParameterName": "CustomField" },
///         { "$include": "_fragments/footer-fields" } 
///       ]
///     }
///     </code>
///     <para>
///         The <c>$include</c> objects are replaced with the array contents from the referenced fragment file.
///         Fragment paths are relative to the base directory (typically the profile's directory).
///     </para>
/// </remarks>
public static class JsonArrayComposer {
    private const string IncludeProperty = "$include";
    private const string FragmentsDirectoryName = "_fragments";

    /// <summary>
    ///     Backward-compatible no-op scope.
    ///     TOON fragment resolution is always enabled for <c>$include</c> lookups.
    /// </summary>
    public static IDisposable EnableToonIncludesScope(bool enabled = true) => NoOpScope.Instance;

    /// <summary>
    ///     Recursively processes a JObject, expanding <c>$include</c> directives in all arrays.
    /// </summary>
    /// <param name="obj">The JObject to process (modified in place)</param>
    /// <param name="baseDirectory">Base directory for resolving relative fragment paths</param>
    /// <param name="fragmentSchemaDirectory">Optional directory where fragment schemas are stored (for schema injection)</param>
    /// <param name="fragmentSchemaFileResolver">
    ///     Optional resolver for property-specific fragment schema file names.
    ///     When omitted, <c>schema-fragment.json</c> is used.
    /// </param>
    public static void ExpandIncludes(
        JObject obj,
        string baseDirectory,
        string? fragmentSchemaDirectory = null,
        Func<string?, string>? fragmentSchemaFileResolver = null
    ) =>
        ExpandIncludes(obj, baseDirectory, [], fragmentSchemaDirectory, fragmentSchemaFileResolver);

    /// <summary>
    ///     Recursively processes a JObject, expanding <c>$include</c> directives in all arrays.
    ///     Tracks visited fragments to detect circular includes.
    /// </summary>
    private static void ExpandIncludes(
        JObject obj,
        string baseDirectory,
        HashSet<string> visitedFragments,
        string? fragmentSchemaDirectory,
        Func<string?, string>? fragmentSchemaFileResolver
    ) {
        foreach (var prop in obj.Properties().ToList()) {
            switch (prop.Value) {
            case JArray array:
                obj[prop.Name] = ExpandArrayIncludes(array, baseDirectory, visitedFragments, fragmentSchemaDirectory,
                    prop.Name, fragmentSchemaFileResolver);
                break;
            case JObject childObj:
                ExpandIncludes(childObj, baseDirectory, visitedFragments, fragmentSchemaDirectory,
                    fragmentSchemaFileResolver);
                break;
            }
        }
    }

    /// <summary>
    ///     Expands <c>$include</c> directives within an array, preserving order.
    /// </summary>
    private static JArray ExpandArrayIncludes(
        JArray array,
        string baseDirectory,
        HashSet<string> visitedFragments,
        string? fragmentSchemaDirectory,
        string? propertyName,
        Func<string?, string>? fragmentSchemaFileResolver
    ) {
        var result = new JArray();

        foreach (var item in array) {
            switch (item) {
            // Check if this item is an $include directive
            case JObject obj when obj.TryGetValue(IncludeProperty, out var includeToken): {
                // Validate include value
                if (includeToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(includeToken.Value<string>())) {
                    throw JsonCompositionException.InvalidIncludeValue(
                        includeToken.Type == JTokenType.String ? "empty string" : includeToken.Type.ToString()
                    );
                }

                var includePath = includeToken.Value<string>()!;
                var fragmentPath = ResolveFragmentPath(includePath, baseDirectory);

                // Check for circular includes
                var normalizedPath = Path.GetFullPath(fragmentPath).ToLowerInvariant();
                if (visitedFragments.Contains(normalizedPath)) {
                    throw JsonCompositionException.CircularFragmentInclude(
                        fragmentPath,
                        visitedFragments.Append(normalizedPath).ToList()
                    );
                }

                // Load and expand the fragment (with schema injection if directory provided)
                var fragmentArray = LoadFragment(fragmentPath, fragmentSchemaDirectory, propertyName,
                    fragmentSchemaFileResolver);

                // Track this fragment for circular detection
                var newVisited = new HashSet<string>(visitedFragments) { normalizedPath };

                // Recursively expand includes within the fragment
                var expandedFragment =
                    ExpandArrayIncludes(fragmentArray, Path.GetDirectoryName(fragmentPath)!, newVisited,
                        fragmentSchemaDirectory, propertyName, fragmentSchemaFileResolver);

                // Add all fragment items to result
                foreach (var fragmentItem in expandedFragment) result.Add(fragmentItem.DeepClone());
                break;
            }
            // Regular item - just add it
            // If it's an object, recursively process it for nested arrays
            case JObject itemObj: {
                var cloned = (JObject)itemObj.DeepClone();
                ExpandIncludes(cloned, baseDirectory, visitedFragments, fragmentSchemaDirectory,
                    fragmentSchemaFileResolver);
                result.Add(cloned);
                break;
            }
            default:
                result.Add(item.DeepClone());
                break;
            }
        }

        return result;
    }

    /// <summary>
    ///     Resolves a fragment path relative to the base directory.
    /// </summary>
    private static string ResolveFragmentPath(string includePath, string baseDirectory) {
        var normalizedIncludePath = includePath.Replace('\\', '/').Trim();
        ValidateIncludePath(normalizedIncludePath);
        var relativePath = normalizedIncludePath.Replace('/', Path.DirectorySeparatorChar);

        var hasJsonExt = normalizedIncludePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
        var hasToonExt = normalizedIncludePath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase);

        if (hasJsonExt || hasToonExt) {
            // Explicit extension path
            return Path.GetFullPath(Path.Combine(baseDirectory, relativePath));
        }

        // Extensionless path: prefer JSON, then TOON.
        var jsonPath = Path.GetFullPath(Path.Combine(baseDirectory, $"{relativePath}.json"));
        if (File.Exists(jsonPath)) return jsonPath;

        var toonPath = Path.GetFullPath(Path.Combine(baseDirectory, $"{relativePath}.toon"));
        if (File.Exists(toonPath)) return toonPath;

        // Keep prior behavior of reporting the expected JSON path when unresolved
        return jsonPath;
    }

    private static void ValidateIncludePath(string includePath) {
        if (string.IsNullOrWhiteSpace(includePath))
            throw JsonCompositionException.InvalidIncludePath(includePath);
        if (Path.IsPathRooted(includePath))
            throw JsonCompositionException.InvalidIncludePath(includePath);

        var segments = includePath.Split(['/'], StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0)
            throw JsonCompositionException.InvalidIncludePath(includePath);
        if (!segments[0].Equals(FragmentsDirectoryName, StringComparison.OrdinalIgnoreCase))
            throw JsonCompositionException.InvalidIncludePath(includePath);
        if (segments.Any(s => s == "." || s == ".."))
            throw JsonCompositionException.InvalidIncludePath(includePath);
    }

    /// <summary>
    ///     Loads a fragment file and returns the Items array from it.
    ///     Fragment files are expected to be JSON objects with an "Items" property containing the array.
    ///     Optionally injects $schema reference if schema directory is provided.
    /// </summary>
    private static JArray LoadFragment(
        string fragmentPath,
        string? fragmentSchemaDirectory,
        string? propertyName,
        Func<string?, string>? fragmentSchemaFileResolver
    ) {
        if (!File.Exists(fragmentPath)) throw JsonCompositionException.FragmentNotFound(fragmentPath);

        try {
            var token = ParseFragmentToken(fragmentPath);

            // Also support fragments authored as a bare array for flexibility.
            if (token is JArray directArray)
                return directArray;

            // Expect fragment to be an object with "Items" property
            if (token is not JObject fragmentObj) {
                throw JsonCompositionException.InvalidFragmentFormat(
                    fragmentPath,
                    $"Expected object with 'Items' property or bare array, got {token.Type}"
                );
            }

            // Extract the Items array
            if (!TryGetItemsArray(fragmentObj, out var array)) {
                throw JsonCompositionException.InvalidFragmentFormat(
                    fragmentPath,
                    "Missing or invalid 'Items' property"
                );
            }

            // Inject schema reference only for JSON fragments. Writing JSON into a .toon file
            // would silently corrupt Toon-authored fragments.
            var isJsonFragment = Path.GetExtension(fragmentPath)
                .Equals(".json", StringComparison.OrdinalIgnoreCase);
            if (isJsonFragment && fragmentSchemaDirectory != null && !fragmentObj.ContainsKey("$schema"))
                InjectFragmentSchema(fragmentPath, fragmentObj, fragmentSchemaDirectory!,
                    fragmentSchemaFileResolver?.Invoke(propertyName));

            return array;
        } catch (JsonCompositionException) {
            throw; // Re-throw our custom exceptions
        } catch (Exception ex) {
            throw JsonCompositionException.FragmentLoadFailed(fragmentPath, ex);
        }
    }

    private static bool TryGetItemsArray(JObject fragmentObj, out JArray array) {
        array = null!;

        if (fragmentObj.TryGetValue("Items", StringComparison.OrdinalIgnoreCase, out var itemsToken)
            && itemsToken is JArray caseInsensitiveArray) {
            array = caseInsensitiveArray;
            return true;
        }

        // Defensive fallback: handle accidental BOM-prefixed property names.
        var bomPrefixed = fragmentObj.Properties()
            .FirstOrDefault(p => p.Name.TrimStart('\uFEFF').Equals("Items", StringComparison.OrdinalIgnoreCase));
        if (bomPrefixed?.Value is JArray bomArray) {
            array = bomArray;
            return true;
        }

        return false;
    }

    private static JToken ParseFragmentToken(string fragmentPath) {
        var ext = Path.GetExtension(fragmentPath);
        if (ext.Equals(".json", StringComparison.OrdinalIgnoreCase)) {
            return JToken.Parse(File.ReadAllText(fragmentPath));
        }

        if (ext.Equals(".toon", StringComparison.OrdinalIgnoreCase)) {
#if NET8_0_OR_GREATER
            var toonContent = File.ReadAllText(fragmentPath);
            var json = ToonTranspiler.DecodeToJson(toonContent);
            return JToken.Parse(json);
#else
            throw new PlatformNotSupportedException("TOON fragment decoding is only available on NET8+ builds.");
#endif
        }

        throw new InvalidOperationException($"Unsupported fragment extension '{ext}' for path '{fragmentPath}'.");
    }

    /// <summary>
    ///     Injects $schema reference into a fragment file.
    ///     This enables LSP validation for fragment files.
    /// </summary>
    private static void InjectFragmentSchema(
        string fragmentPath,
        JObject fragmentObj,
        string schemaDirectory,
        string? schemaFileName
    ) {
        // Calculate relative path to fragment schema
        var fragmentDir = Path.GetDirectoryName(fragmentPath)
                          ?? Path.GetDirectoryName(Path.GetFullPath(fragmentPath))
                          ?? throw JsonCompositionException.InvalidFragmentFormat(fragmentPath, "Invalid fragment path");
        var schemaPath = Path.Combine(schemaDirectory, schemaFileName ?? "schema-fragment.json");
        var relativeSchemaPath = BclExtensions.GetRelativePath(fragmentDir, schemaPath).Replace("\\", "/");

        // Add $schema property
        fragmentObj["$schema"] = relativeSchemaPath;

        // Write back to file
        File.WriteAllText(fragmentPath, JsonConvert.SerializeObject(fragmentObj, Formatting.Indented));
    }

    private sealed class NoOpScope : IDisposable {
        public static readonly NoOpScope Instance = new();
        public void Dispose() { }
    }
}