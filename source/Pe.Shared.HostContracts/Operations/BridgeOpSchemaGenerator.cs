using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using System.Collections.Concurrent;
using System.Reflection;

namespace Pe.Shared.HostContracts.Operations;

/// <summary>
///     JSON Schema generation for the runtime op catalog (/ops). Camel-cased, enums as
///     strings. Direction matters for required-ness:
///     responses — the serializer uses NullValueHandling.Ignore, which only ever omits
///     nulls, so every non-nullable property is marked <c>required</c> (always present);
///     requests — a property is required only when C# gives the caller no fallback:
///     non-nullable AND its constructor parameter has no default value. Everything with
///     a default stays optional (the deserializer fills omissions).
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

    public static string GetRequestSchemaJson(Type type) =>
        SchemaJsonByType.GetOrAdd(
            (type, false),
            static key => {
                var (schema, resolver) = GenerateSchema(key.Item1);
                MarkRequiredRequestProperties(key.Item1, schema, resolver, []);
                return schema.ToJson();
            }
        );

    public static string GetResponseSchemaJson(Type type) =>
        SchemaJsonByType.GetOrAdd(
            (type, true),
            static key => {
                var (schema, _) = GenerateSchema(key.Item1);
                MarkNonNullablePropertiesRequired(schema, []);
                return schema.ToJson();
            }
        );

    private static (JsonSchema Schema, JsonSchemaResolver Resolver) GenerateSchema(Type type) {
        var schema = new JsonSchema();
        var resolver = new JsonSchemaResolver(schema, GeneratorSettings);
        new JsonSchemaGenerator(GeneratorSettings).Generate(schema, type, resolver);
        return (schema, resolver);
    }

    // Requests deserialize through the DTO constructor, so a missing member is only
    // safe when the parameter declares a default. Non-nullable without a default
    // would silently become null/zero — exactly what "required" exists to prevent.
    // The walk pairs the CLR type graph with the schema graph via the resolver.
    private static void MarkRequiredRequestProperties(
        Type type,
        JsonSchema schema,
        JsonSchemaResolver resolver,
        HashSet<Type> visited
    ) {
        if (!visited.Add(type))
            return;

        var objectSchema = schema.ActualSchema;
        var constructorParameters = LargestConstructorParameters(type);
        foreach (var pair in objectSchema.ActualProperties) {
            if (!IsNullable(pair.Value) &&
                constructorParameters.TryGetValue(pair.Key, out var parameter) &&
                !parameter.HasDefaultValue &&
                !objectSchema.RequiredProperties.Contains(pair.Key))
                objectSchema.RequiredProperties.Add(pair.Key);

            var clrProperty = FindClrProperty(type, pair.Key);
            if (clrProperty == null)
                continue;
            foreach (var nested in CandidateObjectTypes(clrProperty.PropertyType, []))
                if (resolver.HasSchema(nested, false))
                    MarkRequiredRequestProperties(nested, resolver.GetSchema(nested, false), resolver, visited);
        }
    }

    private static Dictionary<string, ParameterInfo> LargestConstructorParameters(Type type) {
        // Newtonsoft picks the widest constructor for immutable DTOs and matches
        // JSON members to parameters case-insensitively — mirror that here.
        var constructor = type
            .GetConstructors()
            .OrderByDescending(candidate => candidate.GetParameters().Length)
            .FirstOrDefault();
        var parameters = new Dictionary<string, ParameterInfo>(StringComparer.OrdinalIgnoreCase);
        foreach (var parameter in constructor?.GetParameters() ?? [])
            if (parameter.Name != null)
                parameters[parameter.Name] = parameter;
        return parameters;
    }

    private static PropertyInfo? FindClrProperty(Type type, string jsonName) =>
        type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .FirstOrDefault(property => string.Equals(property.Name, jsonName, StringComparison.OrdinalIgnoreCase));

    // Complex types reachable from a property: unwrap Nullable<T>, arrays, and
    // generic containers (lists, dictionaries) down to their type arguments.
    private static IEnumerable<Type> CandidateObjectTypes(Type type, HashSet<Type> seen) {
        type = Nullable.GetUnderlyingType(type) ?? type;
        if (!seen.Add(type) || type == typeof(string) || type.IsPrimitive || type.IsEnum)
            yield break;
        if (type.IsArray) {
            foreach (var nested in CandidateObjectTypes(type.GetElementType()!, seen))
                yield return nested;
            yield break;
        }

        if (type.IsGenericType) {
            foreach (var argument in type.GetGenericArguments())
            foreach (var nested in CandidateObjectTypes(argument, seen))
                yield return nested;
            yield break;
        }

        yield return type;
    }

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
