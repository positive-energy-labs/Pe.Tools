using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.Revit.SettingsRuntime.Json.Converters;
using Pe.Revit.SettingsRuntime.Json.RevitTypes;
using System.Reflection;

namespace Pe.Revit.SettingsRuntime.Json;

public static class RevitTypeRegistry {
    private static readonly object SyncRoot = new();
    private static bool _initialized;

    public static void Initialize() {
        if (_initialized)
            return;

        lock (SyncRoot) {
            if (_initialized)
                return;

            JsonTypeSchemaBindingRegistry.Shared.Register(
                typeof(ForgeTypeId),
                new RevitJsonTypeSchemaBinding(
                    JsonObjectType.String,
                    property => property.GetCustomAttribute<ForgeKindAttribute>()?.Kind switch {
                        ForgeKind.Spec => new SpecTypeConverter(),
                        ForgeKind.Group => new GroupTypeConverter(),
                        _ => null
                    }
                )
            );

            JsonTypeSchemaBindingRegistry.Shared.Register(
                typeof(BuiltInCategory),
                new RevitJsonTypeSchemaBinding(
                    JsonObjectType.String,
                    _ => new BuiltInCategoryConverter()
                )
            );

            _initialized = true;
        }
    }

    public static void Clear() {
        lock (SyncRoot) {
            JsonTypeSchemaBindingRegistry.Shared.Clear();
            _initialized = false;
        }
    }
}

internal sealed class RevitJsonTypeSchemaBinding(
    JsonObjectType schemaType,
    Func<PropertyInfo, JsonConverter?> converterFactory
) : IJsonTypeSchemaBinding {
    public JsonObjectType SchemaType { get; } = schemaType;

    public JsonConverter? CreateConverter(PropertyInfo propertyInfo) => converterFactory(propertyInfo);

    public void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context) {
        schema.Type = this.SchemaType;
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Properties.Clear();
        schema.Item = null;
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }

    public void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options) {
        if (schema.HasReference)
            schema.Reference = null;

        var isNullable = schema.OneOf.Any(candidate => candidate.Type == JsonObjectType.Null);
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Type = isNullable ? this.SchemaType | JsonObjectType.Null : this.SchemaType;
        schema.Properties.Clear();
        schema.Item = null;
        schema.AdditionalPropertiesSchema = null;
        schema.AllowAdditionalProperties = false;
    }
}

