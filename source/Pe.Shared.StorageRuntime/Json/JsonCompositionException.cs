namespace Pe.Shared.StorageRuntime.Json;

/// <summary>
///     Exception thrown when JSON composition resolution fails.
/// </summary>
public class JsonCompositionException : Exception {
    public JsonCompositionException(string message) : base(message) { }

    public JsonCompositionException(string message, Exception innerException) : base(message, innerException) { }

    public static JsonCompositionException FragmentNotFound(string fragmentPath) => new($"""
         Fragment file not found.
           Expected: {fragmentPath}
           Hint: Ensure the fragment file exists and the path in '$include' is correct.
                 Local fragment paths resolve under the command settings directory via '@local/...'.
                 Global fragment paths resolve under Global/fragments via '@global/...'.
         """);

    public static JsonCompositionException InvalidFragmentFormat(string fragmentPath, string actualType) => new($$"""
          Fragment '{{Path.GetFileName(fragmentPath)}}' has invalid format.
            Expected: either
              - an object with "Items": [ ... ], or
              - a bare array [ ... ]
            Found: {{actualType}}

          Fragment files must contain a JSON array of objects to be inserted into the parent array.
          """);

    public static JsonCompositionException InvalidIncludeValue(string foundType) => new($"""
         Invalid '$include' value.
           Expected: a non-empty string path (e.g., "_fields/header")
           Found: {foundType}
         """);

    public static JsonCompositionException InvalidIncludePath(
        string includePath,
        IEnumerable<string>? allowedRoots = null
    ) {
        var normalizedAllowedRoots = (allowedRoots ?? [])
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(root => root.Replace('\\', '/').Trim('/'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var allowedRootsHint = normalizedAllowedRoots.Count == 0
            ? """
              Expected root example:
                - local: "@local/_fields/my-fragment"
                - global: "@global/_fields/my-fragment"
              """
            : $"""
               Allowed roots for this settings model:
               {string.Join(Environment.NewLine, normalizedAllowedRoots.Select(
                   root => $"  - local: \"@local/{root}/my-fragment\"{Environment.NewLine}    global: \"@global/{root}/my-fragment\""))}
               """;

        return new JsonCompositionException($$"""
                                              Invalid '$include' path '{{includePath}}'.
                                                Fragment includes must start with an allowed designated root from [Includable(...)].
                                              {{allowedRootsHint}}
                                                Relative traversal segments ('.' or '..') and absolute paths are not allowed.
                                              """);
    }

    public static JsonCompositionException CircularFragmentInclude(string fragmentPath, List<string> includeChain) =>
        new($"""
             Circular fragment include detected.
               Fragment: {Path.GetFileName(fragmentPath)}
               Include chain: {string.Join(" -> ", includeChain.Select(Path.GetFileName))}

             Fragment includes must form a tree, not a cycle.
             """);

    public static JsonCompositionException FragmentLoadFailed(string fragmentPath, Exception innerException) => new($"""
         Failed to load fragment '{Path.GetFileName(fragmentPath)}'.
           Path: {fragmentPath}
           Error: {innerException.Message}
         """, innerException);

    public static JsonCompositionException PresetNotFound(string presetPath) => new($"""
         Preset file not found.
           Expected: {presetPath}
           Hint: Ensure the preset file exists and the path in '$preset' is correct.
                 Local preset paths resolve under the command settings directory via '@local/...'.
                 Global preset paths resolve under Global/fragments via '@global/...'.
         """);

    public static JsonCompositionException InvalidPresetValue(string foundType) => new($"""
         Invalid '$preset' value.
           Expected: a non-empty string path (e.g., "@local/_filter-aps-params/default")
           Found: {foundType}
         """);

    public static JsonCompositionException InvalidPresetFormat(string presetPath, string actualType) => new($$"""
          Preset '{{Path.GetFileName(presetPath)}}' has invalid format.
            Expected: a JSON object.
            Found: {{actualType}}
          """);

    public static JsonCompositionException InvalidPresetPath(
        string presetPath,
        IEnumerable<string>? allowedRoots = null
    ) {
        var normalizedAllowedRoots = (allowedRoots ?? [])
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(root => root.Replace('\\', '/').Trim('/'))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var allowedRootsHint = normalizedAllowedRoots.Count == 0
            ? """
              Expected root example:
                - local: "@local/_filter-aps-params/default"
                - global: "@global/_filter-aps-params/default"
              """
            : $"""
               Allowed roots for this settings model:
               {string.Join(Environment.NewLine, normalizedAllowedRoots.Select(
                   root => $"  - local: \"@local/{root}/my-preset\"{Environment.NewLine}    global: \"@global/{root}/my-preset\""))}
               """;

        return new JsonCompositionException($$"""
                                              Invalid '$preset' path '{{presetPath}}'.
                                                Presets must start with an allowed designated root from [Presettable(...)].
                                              {{allowedRootsHint}}
                                                Relative traversal segments ('.' or '..') and absolute paths are not allowed.
                                              """);
    }

    public static JsonCompositionException CircularPresetInclude(string presetPath, List<string> includeChain) => new(
        $"""
         Circular preset include detected.
           Preset: {Path.GetFileName(presetPath)}
           Include chain: {string.Join(" -> ", includeChain.Select(Path.GetFileName))}

         Preset includes must form a tree, not a cycle.
         """);

    public static JsonCompositionException PresetLoadFailed(string presetPath, Exception innerException) => new($"""
         Failed to load preset '{Path.GetFileName(presetPath)}'.
           Path: {presetPath}
           Error: {innerException.Message}
         """, innerException);

    public static JsonCompositionException PresetOverridesNotSupported() => new("""
        Invalid '$preset' usage.
          Preset composition does not support inline overrides.
          Use either:
            - a preset object: { "$preset": "@local/_root/name" }
            - or a full inline settings object
          but not both in the same object.
        """);
}