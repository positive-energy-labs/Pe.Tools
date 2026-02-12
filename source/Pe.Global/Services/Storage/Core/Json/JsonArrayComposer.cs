using Newtonsoft.Json;
using Pe.Global.PolyFill;
using Newtonsoft.Json.Linq;
using System.Threading;
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
    private static readonly AsyncLocal<bool> ToonIncludesEnabled = new();

    /// <summary>
    ///     Enables TOON fragment resolution for the current async flow scope.
    ///     Use this to opt-in command paths incrementally without global behavior changes.
    /// </summary>
    public static IDisposable EnableToonIncludesScope(bool enabled = true) {
        var previous = ToonIncludesEnabled.Value;
        ToonIncludesEnabled.Value = enabled;
        return new Scope(() => ToonIncludesEnabled.Value = previous);
    }

    /// <summary>
    ///     Recursively processes a JObject, expanding <c>$include</c> directives in all arrays.
    /// </summary>
    /// <param name="obj">The JObject to process (modified in place)</param>
    /// <param name="baseDirectory">Base directory for resolving relative fragment paths</param>
    /// <param name="fragmentSchemaDirectory">Optional directory where fragment schemas are stored (for schema injection)</param>
    public static void ExpandIncludes(JObject obj, string baseDirectory, string? fragmentSchemaDirectory = null) =>
        ExpandIncludes(obj, baseDirectory, [], fragmentSchemaDirectory);

    /// <summary>
    ///     Recursively processes a JObject, expanding <c>$include</c> directives in all arrays.
    ///     Tracks visited fragments to detect circular includes.
    /// </summary>
    private static void ExpandIncludes(
        JObject obj,
        string baseDirectory,
        HashSet<string> visitedFragments,
        string? fragmentSchemaDirectory
    ) {
        foreach (var prop in obj.Properties().ToList()) {
            switch (prop.Value) {
            case JArray array:
                obj[prop.Name] = ExpandArrayIncludes(array, baseDirectory, visitedFragments, fragmentSchemaDirectory);
                break;
            case JObject childObj:
                ExpandIncludes(childObj, baseDirectory, visitedFragments, fragmentSchemaDirectory);
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
        string? fragmentSchemaDirectory
    ) {
        var result = new JArray();

        foreach (var item in array) {
            switch (item) {
            // Check if this item is an $include directive
            case JObject obj when obj.TryGetValue(IncludeProperty, out var includeToken): {
                // Validate include value
                if (includeToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(includeToken.Value<string>())) {
                    throw JsonExtendsException.InvalidIncludeValue(
                        includeToken.Type == JTokenType.String ? "empty string" : includeToken.Type.ToString()
                    );
                }

                var includePath = includeToken.Value<string>()!;
                var fragmentPath = ResolveFragmentPath(includePath, baseDirectory);

                // Check for circular includes
                var normalizedPath = Path.GetFullPath(fragmentPath).ToLowerInvariant();
                if (visitedFragments.Contains(normalizedPath)) {
                    throw JsonExtendsException.CircularFragmentInclude(
                        fragmentPath,
                        visitedFragments.Append(normalizedPath).ToList()
                    );
                }

                // Load and expand the fragment (with schema injection if directory provided)
                var fragmentArray = LoadFragment(fragmentPath, fragmentSchemaDirectory);

                // Track this fragment for circular detection
                var newVisited = new HashSet<string>(visitedFragments) { normalizedPath };

                // Recursively expand includes within the fragment
                var expandedFragment =
                    ExpandArrayIncludes(fragmentArray, Path.GetDirectoryName(fragmentPath)!, newVisited,
                        fragmentSchemaDirectory);

                // Add all fragment items to result
                foreach (var fragmentItem in expandedFragment) result.Add(fragmentItem.DeepClone());
                break;
            }
            // Regular item - just add it
            // If it's an object, recursively process it for nested arrays
            case JObject itemObj: {
                var cloned = (JObject)itemObj.DeepClone();
                ExpandIncludes(cloned, baseDirectory, visitedFragments, fragmentSchemaDirectory);
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
        var hasJsonExt = includePath.EndsWith(".json", StringComparison.OrdinalIgnoreCase);
        var hasToonExt = includePath.EndsWith(".toon", StringComparison.OrdinalIgnoreCase);

        if (hasJsonExt || hasToonExt) {
            // Explicit extension path
            return Path.GetFullPath(Path.Combine(baseDirectory, includePath));
        }

        // Extensionless path: prefer JSON, then TOON (if enabled)
        var jsonPath = Path.GetFullPath(Path.Combine(baseDirectory, $"{includePath}.json"));
        if (File.Exists(jsonPath)) return jsonPath;

        if (ToonIncludesEnabled.Value) {
            var toonPath = Path.GetFullPath(Path.Combine(baseDirectory, $"{includePath}.toon"));
            if (File.Exists(toonPath)) return toonPath;
        }

        // Keep prior behavior of reporting the expected JSON path when unresolved
        return jsonPath;
    }

    /// <summary>
    ///     Loads a fragment file and returns the Items array from it.
    ///     Fragment files are expected to be JSON objects with an "Items" property containing the array.
    ///     Optionally injects $schema reference if schema directory is provided.
    /// </summary>
    private static JArray LoadFragment(string fragmentPath, string? fragmentSchemaDirectory) {
        if (!File.Exists(fragmentPath)) throw JsonExtendsException.FragmentNotFound(fragmentPath);

        try {
            var token = ParseFragmentToken(fragmentPath);

            // Expect fragment to be an object with "Items" property
            if (token is not JObject fragmentObj) {
                throw JsonExtendsException.InvalidFragmentFormat(
                    fragmentPath,
                    $"Expected object with 'Items' property, got {token.Type}"
                );
            }

            // Extract the Items array
            if (!fragmentObj.TryGetValue("Items", out var itemsToken) || itemsToken is not JArray array) {
                throw JsonExtendsException.InvalidFragmentFormat(
                    fragmentPath,
                    "Missing or invalid 'Items' property"
                );
            }

            // Inject schema reference if schema directory provided and not already present
            if (fragmentSchemaDirectory != null && !fragmentObj.ContainsKey("$schema"))
                InjectFragmentSchema(fragmentPath, fragmentObj, fragmentSchemaDirectory!);

            return array;
        } catch (JsonExtendsException) {
            throw; // Re-throw our custom exceptions
        } catch (Exception ex) {
            throw JsonExtendsException.FragmentLoadFailed(fragmentPath, ex);
        }
    }

    private static JToken ParseFragmentToken(string fragmentPath) {
        var ext = Path.GetExtension(fragmentPath);
        if (ext.Equals(".json", StringComparison.OrdinalIgnoreCase)) {
            return JToken.Parse(File.ReadAllText(fragmentPath));
        }

        if (ext.Equals(".toon", StringComparison.OrdinalIgnoreCase)) {
            if (!ToonIncludesEnabled.Value) {
                throw new InvalidOperationException(
                    $"TOON fragment include is disabled for path '{fragmentPath}'. " +
                    $"Enable via {nameof(EnableToonIncludesScope)} in the calling command path.");
            }

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
    private static void InjectFragmentSchema(string fragmentPath, JObject fragmentObj, string schemaDirectory) {
        // Calculate relative path to fragment schema
        var fragmentDir = Path.GetDirectoryName(fragmentPath)
                          ?? Path.GetDirectoryName(Path.GetFullPath(fragmentPath))
                          ?? throw JsonExtendsException.InvalidFragmentFormat(fragmentPath, "Invalid fragment path");
        var schemaPath = Path.Combine(schemaDirectory, "schema-fragment.json");
        var relativeSchemaPath = BclExtensions.GetRelativePath(fragmentDir, schemaPath).Replace("\\", "/");

        // Add $schema property
        fragmentObj["$schema"] = relativeSchemaPath;

        // Write back to file
        File.WriteAllText(fragmentPath, JsonConvert.SerializeObject(fragmentObj, Formatting.Indented));
    }

    private sealed class Scope(Action onDispose) : IDisposable {
        private bool _disposed;

        public void Dispose() {
            if (this._disposed) return;
            this._disposed = true;
            onDispose();
        }
    }
}