using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

/// <summary>
///     Schema processor that transforms [Includable] array properties to allow $include directives.
///     Generates oneOf schema: either the regular item type OR an include directive object.
/// </summary>
/// <remarks>
///     <para>For a property marked with [Includable(IncludableFragmentRoot.Fields)]:</para>
///     <code>
///     public List&lt;ScheduleFieldSpec&gt; Fields { get; set; }
///     </code>
///     <para>The generated schema items become:</para>
///     <code>
///     {
///       "oneOf": [
///         { "$ref": "#/definitions/ScheduleFieldSpec" },
///         {
///           "type": "object",
///           "additionalProperties": false,
///           "properties": { "$include": { "type": "string" } },
///           "required": ["$include"]
///         }
///       ]
///     }
///     </code>
/// </remarks>
public class IncludableSchemaProcessor : ISchemaProcessor {
    /// <summary>
    ///     Processes the schema context, transforming [Includable] array properties
    ///     to allow $include directives in their items.
    /// </summary>
    public void Process(SchemaProcessorContext context) {
        // Process each property in the type for [Includable] attribute
        if (!context.ContextualType.Type.IsClass) return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr == null) continue;

            // Check if the C# type is a list/array type
            if (!IsCollectionType(property.PropertyType)) continue;

            var propertyName = GetJsonPropertyName(property);
            if (!context.Schema.Properties.TryGetValue(propertyName, out var propSchema)) continue;

            // Ensure schema has an Item schema to modify
            if (propSchema.Item == null) continue;

            // Transform array items to oneOf: [regularItem, includeDirective]
            var includeDirectiveSchema = CreateIncludeDirectiveSchema(includableAttr);
            var originalItemSchema = propSchema.Item;

            var newItemSchema = new JsonSchema();
            newItemSchema.OneOf.Add(originalItemSchema);
            newItemSchema.OneOf.Add(includeDirectiveSchema);

            propSchema.Item = newItemSchema;
        }
    }

    private static bool IsCollectionType(Type type) {
        if (type.IsArray) return true;
        if (!type.IsGenericType) return false;

        var genericDef = type.GetGenericTypeDefinition();
        return genericDef == typeof(List<>) ||
               genericDef == typeof(IList<>) ||
               genericDef == typeof(ICollection<>) ||
               genericDef == typeof(IEnumerable<>);
    }

    private static string GetJsonPropertyName(PropertyInfo property) {
        var jsonPropAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
        return jsonPropAttr?.PropertyName ?? property.Name;
    }

    /// <summary>
    ///     Creates the schema for $include directive objects.
    /// </summary>
    private static JsonSchema CreateIncludeDirectiveSchema(IncludableAttribute includableAttr) {
        var fragmentSchemaName = string.IsNullOrWhiteSpace(includableAttr.FragmentSchemaName)
            ? null
            : includableAttr.FragmentSchemaName;
        var normalizedRoot = fragmentSchemaName == null
            ? null
            : IncludableFragmentRoots.NormalizeRoot(fragmentSchemaName);

        var schema = new JsonSchema { Type = JsonObjectType.Object, AllowAdditionalProperties = false };

        var includeProperty = new JsonSchemaProperty {
            Type = JsonObjectType.String,
            Description = "Path to fragment file (relative to schema directory, without .json extension)",
            IsRequired = true
        };
        if (!string.IsNullOrWhiteSpace(normalizedRoot)) {
            includeProperty.ExtensionData ??= new Dictionary<string, object?>();
            includeProperty.ExtensionData["examples"] = new List<string> {
                $"@local/{normalizedRoot}/my-fragment",
                $"@global/{normalizedRoot}/my-fragment"
            };
        }

        schema.Properties["$include"] = includeProperty;

        return schema;
    }
}