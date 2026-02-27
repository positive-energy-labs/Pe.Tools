namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Exception thrown when JSON composition resolution fails.
/// </summary>
public class JsonCompositionException : Exception {
  public JsonCompositionException(string message) : base(message) { }
  public JsonCompositionException(string message, Exception innerException) : base(message, innerException) { }

  /// <summary>Creates an exception for when a fragment file is not found.</summary>
  public static JsonCompositionException FragmentNotFound(
      string fragmentPath
  ) => new($"""
              Fragment file not found.
                Expected: {fragmentPath}
                Hint: Ensure the fragment file exists and the path in '$include' is correct.
                      Fragment paths are relative to the profile's directory.
              """);

  /// <summary>Creates an exception for invalid fragment format (not a JSON array).</summary>
  public static JsonCompositionException InvalidFragmentFormat(
      string fragmentPath,
      string actualType
  ) => new($$"""
               Fragment '{{Path.GetFileName(fragmentPath)}}' has invalid format.
                 Expected: either
                   - an object with "Items": [ ... ], or
                   - a bare array [ ... ]
                 Found: {{actualType}}
                 
               Fragment files must contain a JSON array of objects to be inserted into the parent array.
               """);

  /// <summary>Creates an exception for invalid $include value.</summary>
  public static JsonCompositionException InvalidIncludeValue(
      string foundType
  ) => new($"""
              Invalid '$include' value.
                Expected: a non-empty string path (e.g., "_fields/header")
                Found: {foundType}
              """);

  /// <summary>Creates an exception for invalid $include path conventions.</summary>
  public static JsonCompositionException InvalidIncludePath(string includePath) =>
      new($"""
              Invalid '$include' path '{includePath}'.
                Fragment includes must start with an allowed designated root from [Includable(...)].
                Example: "_fields/my-fragment"
                Relative traversal segments ('.' or '..') and absolute paths are not allowed.
              """);

  /// <summary>Creates an exception for circular fragment includes.</summary>
  public static JsonCompositionException CircularFragmentInclude(
      string fragmentPath,
      List<string> includeChain
  ) => new($"""
              Circular fragment include detected.
                Fragment: {Path.GetFileName(fragmentPath)}
                Include chain: {string.Join(" → ", includeChain.Select(Path.GetFileName))}
                
              Fragment includes must form a tree, not a cycle.
              """);

  /// <summary>Creates an exception when fragment file fails to load or parse.</summary>
  public static JsonCompositionException FragmentLoadFailed(
      string fragmentPath,
      Exception innerException
  ) => new($"""
              Failed to load fragment '{Path.GetFileName(fragmentPath)}'.
                Path: {fragmentPath}
                Error: {innerException.Message}
              """, innerException);
}
