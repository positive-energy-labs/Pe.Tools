using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation.TypeMappers;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Reflection;
using System.Runtime.CompilerServices;

namespace Pe.Revit.FamilyFoundry;

internal static class AuthoredParamDrivenSolidsSchemaBindingBootstrapper {
    [ModuleInitializer]
    internal static void Register() {
        JsonTypeSchemaBindingRegistry.Shared.Register(
            typeof(PlaneRefOrInlinePlaneSpec),
            new PlaneRefOrInlinePlaneSchemaBinding());
        JsonTypeSchemaBindingRegistry.Shared.Register(
            typeof(PlanePairOrInlineSpanSpec),
            new PlanePairOrInlineSpanSchemaBinding());
    }
}

internal sealed class PlaneRefOrInlinePlaneSchemaBinding : IJsonTypeSchemaBinding {
    public JsonObjectType SchemaType => JsonObjectType.None;

    public JsonConverter? CreateConverter(PropertyInfo propertyInfo) => null;

    public void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context) => ApplyUnionSchema(schema);

    public void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options) =>
        ApplyUnionSchema(schema);

    private static void ApplyUnionSchema(JsonSchema schema) {
        Reset(schema);
        schema.AnyOf.Add(new JsonSchema { Type = JsonObjectType.String });
        schema.AnyOf.Add(
            AuthoredParamDrivenSolidsSchemaFragments.BuildLeafSchema<AuthoredNamedPlaneSpec>(
                nameof(AuthoredNamedPlaneSpec.Name))
        );
        schema.AnyOf.Add(AuthoredParamDrivenSolidsSchemaFragments.BuildLeafSchema<AuthoredEndOffsetPlaneSpec>());
    }

    private static void Reset(JsonSchema schema) {
        if (schema.HasReference)
            schema.Reference = null;

        schema.Type = JsonObjectType.None;
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Properties.Clear();
        schema.Item = null;
        schema.AllowAdditionalProperties = true;
        schema.AdditionalPropertiesSchema = null;
        schema.Enumeration.Clear();
    }
}

internal sealed class PlanePairOrInlineSpanSchemaBinding : IJsonTypeSchemaBinding {
    public JsonObjectType SchemaType => JsonObjectType.None;

    public JsonConverter? CreateConverter(PropertyInfo propertyInfo) => null;

    public void ConfigureTypeSchema(JsonSchema schema, TypeMapperContext context) => ApplyUnionSchema(schema);

    public void ConfigurePropertySchema(JsonSchema schema, PropertyInfo propertyInfo, JsonSchemaBuildOptions options) =>
        ApplyUnionSchema(schema);

    private static void ApplyUnionSchema(JsonSchema schema) {
        Reset(schema);

        var arraySchema = new JsonSchema {
            Type = JsonObjectType.Array, Item = new JsonSchema { Type = JsonObjectType.String }
        };

        schema.OneOf.Add(arraySchema);
        schema.OneOf.Add(AuthoredParamDrivenSolidsSchemaFragments.BuildLeafSchema<AuthoredSpanSpec>());
    }

    private static void Reset(JsonSchema schema) {
        if (schema.HasReference)
            schema.Reference = null;

        schema.Type = JsonObjectType.None;
        schema.OneOf.Clear();
        schema.AnyOf.Clear();
        schema.AllOf.Clear();
        schema.Properties.Clear();
        schema.Item = null;
        schema.AllowAdditionalProperties = true;
        schema.AdditionalPropertiesSchema = null;
        schema.Enumeration.Clear();
    }
}

internal static class AuthoredParamDrivenSolidsSchemaFragments {
    public static JsonSchema BuildLeafSchema<T>(params string[] requiredProperties) {
        var schema = RevitJsonSchemaFactory.BuildAuthoringSchema(
            typeof(T),
            SettingsRuntimeMode.HostOnly,
            resolveFieldOptionSamples: false
        );

        var required = requiredProperties
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var schemaObject = JObject.Parse(schema.ToJson());
        _ = schemaObject.Remove("$schema");
        if (schemaObject["properties"] is JObject properties)
            _ = properties.Remove("$schema");

        if (required.Length == 0)
            return JsonSchema.FromJsonAsync(schemaObject.ToString(Formatting.None)).GetAwaiter().GetResult();

        schemaObject["required"] = new JArray(required);
        return JsonSchema.FromJsonAsync(schemaObject.ToString(Formatting.None)).GetAwaiter().GetResult();
    }
}
