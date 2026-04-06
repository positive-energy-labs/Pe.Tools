using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;
using System.Reflection;

namespace Pe.Shared.StorageRuntime.Json.SchemaProcessors;

public class SchemaIncludesProcessor : ISchemaProcessor {
    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass)
            return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr == null || !IsCollectionType(property.PropertyType))
                continue;

            var propertyName = GetJsonPropertyName(property);
            if (!context.Schema.Properties.TryGetValue(propertyName, out var propSchema) || propSchema.Item == null)
                continue;

            var includeDirectiveSchema = CreateIncludeDirectiveSchema(includableAttr);
            var originalItemSchema = propSchema.Item;

            var newItemSchema = new JsonSchema();
            newItemSchema.OneOf.Add(originalItemSchema);
            newItemSchema.OneOf.Add(includeDirectiveSchema);

            propSchema.Item = newItemSchema;
        }
    }

    private static bool IsCollectionType(Type type) {
        if (type.IsArray)
            return true;
        if (!type.IsGenericType)
            return false;

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
                $"@local/{normalizedRoot}/my-fragment", $"@global/{normalizedRoot}/my-fragment"
            };
        }

        schema.Properties["$include"] = includeProperty;

        return schema;
    }
}