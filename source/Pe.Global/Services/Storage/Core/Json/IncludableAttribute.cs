namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Marks a List property as supporting $include directives for array composition.
///     Generates schema allowing either regular items OR {"$include": "path"} objects.
/// </summary>
/// <remarks>
///     <para>Usage:</para>
///     <code>
///     public class ScheduleSpec {
///         [Includable("fields")]
///         public List&lt;ScheduleFieldSpec&gt; Fields { get; set; } = [];
///     }
///     </code>
///     <para>This generates a schema that allows either:</para>
///     <list type="bullet">
///         <item>Regular ScheduleFieldSpec objects</item>
///         <item>Include directive objects: { "$include": "_fragments/header" }</item>
///     </list>
/// </remarks>
[AttributeUsage(AttributeTargets.Property)]
public class IncludableAttribute : Attribute {
    /// <summary>
    ///     Marks a List property as supporting $include directives.
    /// </summary>
    /// <param name="fragmentSchemaName">
    ///     Optional name for the fragment schema file.
    ///     Defaults to the property name in lowercase if not specified.
    /// </param>
    public IncludableAttribute(string? fragmentSchemaName = null) => this.FragmentSchemaName = fragmentSchemaName;

    /// <summary>
    ///     Name used for fragment schema file (e.g., "fields" → "schema-fragment-fields.json").
    ///     If not specified, uses the property name in lowercase.
    /// </summary>
    public string? FragmentSchemaName { get; }
}