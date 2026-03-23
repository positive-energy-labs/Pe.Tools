using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;
using System.Reflection;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

public sealed class SchemaPresetsProcessor : ISchemaProcessor {
    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass)
            return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var presettableAttr = property.GetCustomAttribute<PresettableAttribute>();
            if (presettableAttr == null || !IsComplexObjectType(property.PropertyType))
                continue;

            var jsonPropAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
            var propertyName = jsonPropAttr?.PropertyName ?? property.Name;

            if (!context.Schema.Properties.TryGetValue(propertyName, out var propSchema))
                continue;

            var presetSchema = CreatePresetDirectiveObjectSchema(presettableAttr.FragmentSchemaName);

            var unionSchema = new JsonSchemaProperty {
                IsRequired = propSchema.IsRequired,
                Description = propSchema.Description,
                Default = propSchema.Default,
                ExtensionData = propSchema.ExtensionData == null
                    ? null
                    : new Dictionary<string, object?>(propSchema.ExtensionData)
            };

            unionSchema.OneOf.Add(propSchema);
            unionSchema.OneOf.Add(presetSchema);

            context.Schema.Properties[propertyName] = unionSchema;
        }
    }

    private static bool IsComplexObjectType(Type propertyType) {
        var type = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (type == typeof(string) || type.IsPrimitive || type.IsEnum)
            return false;
        if (type.IsArray)
            return false;
        if (type.IsGenericType) {
            var genericDef = type.GetGenericTypeDefinition();
            if (genericDef == typeof(List<>) ||
                genericDef == typeof(IList<>) ||
                genericDef == typeof(ICollection<>) ||
                genericDef == typeof(IEnumerable<>))
                return false;
        }

        return type.IsClass;
    }

    private static JsonSchema CreatePresetDirectiveObjectSchema(string fragmentSchemaName) {
        var schema = new JsonSchema { Type = JsonObjectType.Object, AllowAdditionalProperties = false };

        var normalizedRoot = IncludableFragmentRoots.NormalizeRoot(fragmentSchemaName);

        var presetProperty = new JsonSchemaProperty {
            Type = JsonObjectType.String,
            IsRequired = true,
            Description = "Path to preset file (without .json extension)."
        };
        presetProperty.ExtensionData ??= new Dictionary<string, object?>();
        presetProperty.ExtensionData["examples"] = new List<string> {
            $"@local/{normalizedRoot}/my-preset", $"@global/{normalizedRoot}/my-preset"
        };

        schema.Properties["$preset"] = presetProperty;
        schema.RequiredProperties.Add("$preset");
        return schema;
    }
}
