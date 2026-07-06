using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using System.Collections.Concurrent;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     JSON Schema generation for the runtime op catalog (/ops). Camel-cased, enums as
///     strings. Direction matters for required-ness:
///     responses — the serializer uses NullValueHandling.Ignore, which only ever omits
///     nulls, so every non-nullable property is marked <c>required</c> (always present);
///     requests — C# DTOs carry defaults and the deserializer fills omitted members, so
///     nothing is required (callers send only what they mean).
/// </summary>
public static class BridgeOpSchemaGenerator {
    private static readonly ConcurrentDictionary<(Type, bool), string> SchemaJsonByType = new();

    private static readonly NewtonsoftJsonSchemaGeneratorSettings GeneratorSettings = new() {
        FlattenInheritanceHierarchy = true,
        // Honor C# nullable annotations: string stays non-nullable, string? becomes ["string","null"].
        DefaultReferenceTypeNullHandling = ReferenceTypeNullHandling.NotNull,
        SerializerSettings = new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new DefaultContractResolver {
                NamingStrategy = new CamelCaseNamingStrategy {
                    ProcessDictionaryKeys = false,
                    OverrideSpecifiedNames = false
                }
            },
            Converters = [new StringEnumConverter()]
        }
    };

    public static string GetRequestSchemaJson(Type type) => GetSchemaJson(type, markRequired: false);

    public static string GetResponseSchemaJson(Type type) => GetSchemaJson(type, markRequired: true);

    private static string GetSchemaJson(Type type, bool markRequired) =>
        SchemaJsonByType.GetOrAdd(
            (type, markRequired),
            static key => {
                var schema = new JsonSchemaGenerator(GeneratorSettings).Generate(key.Item1);
                if (key.Item2)
                    MarkNonNullablePropertiesRequired(schema, []);
                return schema.ToJson();
            }
        );

    // NJsonSchema treats nullability and required-ness independently; with
    // NullValueHandling.Ignore the wire omits a property only when it is null,
    // so "cannot be null" is exactly "always present".
    private static void MarkNonNullablePropertiesRequired(JsonSchema schema, HashSet<JsonSchema> visited) {
        if (!visited.Add(schema))
            return;

        foreach (var definition in schema.Definitions.Values)
            MarkNonNullablePropertiesRequired(definition, visited);

        var objectSchema = schema.ActualSchema;
        if (visited.Add(objectSchema))
            MarkNonNullablePropertiesRequired(objectSchema, visited);

        foreach (var pair in objectSchema.ActualProperties) {
            if (!IsNullable(pair.Value) && !objectSchema.RequiredProperties.Contains(pair.Key))
                objectSchema.RequiredProperties.Add(pair.Key);
            MarkNonNullablePropertiesRequired(pair.Value, visited);
        }

        if (schema.Item != null)
            MarkNonNullablePropertiesRequired(schema.Item, visited);
        if (schema.AdditionalPropertiesSchema != null)
            MarkNonNullablePropertiesRequired(schema.AdditionalPropertiesSchema, visited);
    }

    private static bool IsNullable(JsonSchemaProperty property) {
        if (property.Type.HasFlag(JsonObjectType.Null))
            return true;
        // $ref/oneOf wrappers: nullable when any branch is the null type.
        return property.OneOf.Any(branch => branch.Type == JsonObjectType.Null);
    }
}
