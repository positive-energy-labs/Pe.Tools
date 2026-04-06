using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.Shared.StorageRuntime.Core.Json;

internal static class SchemaDocumentSchemaResolver {
    public static JsonSchema? ResolveForToken(JsonSchema? schema, JToken token) {
        var effectiveSchema = Unwrap(schema);
        if (effectiveSchema == null)
            return null;

        var candidateSchemas = effectiveSchema.OneOf
            .Concat(effectiveSchema.AnyOf)
            .Select(Unwrap)
            .Where(candidate => candidate != null)
            .Cast<JsonSchema>()
            .ToList();
        if (candidateSchemas.Count == 0)
            return effectiveSchema;

        var selectedSchema = candidateSchemas
            .Select(candidate => new {
                Schema = candidate,
                ErrorCount = CountValidationErrors(candidate, token),
                MatchCount = CountDirectPropertyMatches(candidate, token)
            })
            .OrderBy(candidate => candidate.ErrorCount)
            .ThenByDescending(candidate => candidate.MatchCount)
            .Select(candidate => candidate.Schema)
            .FirstOrDefault();

        return selectedSchema == null ? effectiveSchema : ResolveForToken(selectedSchema, token);
    }

    public static JsonSchema? ResolveObjectPropertySchema(
        JsonSchema? schema,
        JObject obj,
        string propertyName
    ) {
        var effectiveSchema = ResolveForToken(schema, obj);
        if (effectiveSchema == null)
            return null;

        if (effectiveSchema.Properties.TryGetValue(propertyName, out var propertySchema))
            return Unwrap(propertySchema);

        return Unwrap(effectiveSchema.AdditionalPropertiesSchema);
    }

    public static JsonSchema? ResolveArrayItemSchema(JsonSchema? schema, JArray array) =>
        Unwrap(ResolveForToken(schema, array)?.Item);

    public static JsonSchema? Unwrap(JsonSchema? schema) =>
        schema == null ? null : schema.HasReference ? schema.Reference : schema;

    private static int CountValidationErrors(JsonSchema schema, JToken token) {
        try {
            return schema.Validate(token).Count;
        } catch {
            return int.MaxValue;
        }
    }

    private static int CountDirectPropertyMatches(JsonSchema schema, JToken token) {
        if (token is not JObject obj)
            return 0;

        var hasAdditionalProperties = schema.AdditionalPropertiesSchema != null;
        var propertyNames = schema.Properties.Keys.ToHashSet(StringComparer.Ordinal);
        return obj.Properties().Count(property =>
            !property.Name.StartsWith("$", StringComparison.Ordinal) &&
            (propertyNames.Contains(property.Name) || hasAdditionalProperties)
        );
    }
}
