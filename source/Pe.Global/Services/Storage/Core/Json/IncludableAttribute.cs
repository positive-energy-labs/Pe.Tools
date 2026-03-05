namespace Pe.Global.Services.Storage.Core.Json;

public enum IncludableFragmentRoot {
    FamilyNames,
    SharedParameterNames,
    MappingData,
    StressMappingData,
    Fields,
    TestItems
}

public static class IncludableFragmentRoots {
    public static string ToSchemaName(IncludableFragmentRoot root) => root switch {
        IncludableFragmentRoot.FamilyNames => "family-names",
        IncludableFragmentRoot.SharedParameterNames => "shared-parameter-names",
        IncludableFragmentRoot.MappingData => "mapping-data",
        IncludableFragmentRoot.StressMappingData => "stress-mapping-data",
        IncludableFragmentRoot.Fields => "fields",
        IncludableFragmentRoot.TestItems => "test-items",
        _ => throw new ArgumentOutOfRangeException(nameof(root), root, "Unsupported includable fragment root.")
    };

    public static string NormalizeRoot(string rawRoot) {
        var normalized = rawRoot.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            throw new InvalidOperationException("Includable fragment root cannot be empty.");
        if (normalized.Contains('/') || normalized == "." || normalized == "..")
            throw new InvalidOperationException($"Invalid includable fragment root '{rawRoot}'.");
        return normalized.StartsWith("_", StringComparison.Ordinal) ? normalized : "_" + normalized;
    }

    public static string ToNormalizedRoot(IncludableFragmentRoot root) =>
        NormalizeRoot(ToSchemaName(root));
}

/// <summary>
///     Marks a List property as supporting $include directives for array composition.
///     Generates schema allowing either regular items OR {"$include": "path"} objects.
/// </summary>
/// <remarks>
///     <para>Usage:</para>
///     <code>
///     public class ScheduleSpec {
///         [Includable(IncludableFragmentRoot.Fields)]
///         public List&lt;ScheduleFieldSpec&gt; Fields { get; set; } = [];
///     }
///     </code>
///     <para>This generates a schema that allows either:</para>
///     <list type="bullet">
///         <item>Regular ScheduleFieldSpec objects</item>
///         <item>Include directive objects: { "$include": "@local/_fields/header" }</item>
///     </list>
/// </remarks>
[AttributeUsage(AttributeTargets.Property)]
public class IncludableAttribute : Attribute {
    public IncludableAttribute(IncludableFragmentRoot fragmentRoot)
        : this(IncludableFragmentRoots.ToSchemaName(fragmentRoot)) { }

    /// <summary>
    ///     Marks a List property as supporting $include directives.
    /// </summary>
    /// <param name="fragmentSchemaName">
    ///     Optional name for the fragment schema file.
    ///     Defaults to the property name in lowercase if not specified.
    /// </param>
    public IncludableAttribute(string? fragmentSchemaName = null) => this.FragmentSchemaName = fragmentSchemaName;

    /// <summary>
    ///     Root directory key for fragments. Effective include root is always "_" + this value.
    ///     Example: "fields" => "_fields", "_fields" => "_fields".
    ///     If not specified, uses the property name in lowercase.
    /// </summary>
    public string? FragmentSchemaName { get; }
}