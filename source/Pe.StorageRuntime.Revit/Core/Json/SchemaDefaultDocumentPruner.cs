using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal static class SchemaDefaultDocumentPruner {
    public static void Prune(JsonSchema schema, JToken documentToken) {
        if (schema == null)
            throw new ArgumentNullException(nameof(schema));
        if (documentToken == null)
            throw new ArgumentNullException(nameof(documentToken));

        _ = PruneNode(schema, documentToken, isRoot: true);
    }

    private static bool PruneNode(JsonSchema? schema, JToken token, bool isRoot = false) {
        var effectiveSchema = SchemaDocumentSchemaResolver.ResolveForToken(schema, token);
        if (effectiveSchema == null)
            return false;

        if (token is JObject obj)
            return PruneObject(effectiveSchema, obj, isRoot);

        if (token is JArray array)
            return PruneArray(effectiveSchema, array, isRoot);

        return !isRoot && MatchesExplicitDefault(effectiveSchema, token);
    }

    private static bool PruneObject(JsonSchema schema, JObject obj, bool isRoot) {
        foreach (var property in obj.Properties().ToList()) {
            if (ShouldPreserveProperty(property.Name))
                continue;

            var propertySchema = SchemaDocumentSchemaResolver.ResolveObjectPropertySchema(
                schema,
                obj,
                property.Name
            );
            if (propertySchema == null)
                continue;

            var shouldRemove = PruneNode(propertySchema, property.Value);
            if (shouldRemove)
                property.Remove();
        }

        return !isRoot && MatchesExplicitDefault(schema, obj);
    }

    private static bool PruneArray(JsonSchema schema, JArray array, bool isRoot) {
        var itemSchema = SchemaDocumentSchemaResolver.ResolveArrayItemSchema(schema, array);
        if (itemSchema != null) {
            foreach (var item in array) {
                _ = PruneNode(itemSchema, item);
            }
        }

        return !isRoot && MatchesExplicitDefault(schema, array);
    }

    private static bool MatchesExplicitDefault(JsonSchema schema, JToken token) =>
        TryGetExplicitDefaultToken(schema, out var defaultToken) &&
        JToken.DeepEquals(token, defaultToken);

    private static bool TryGetExplicitDefaultToken(JsonSchema schema, out JToken defaultToken) {
        var defaultValue = SchemaDocumentSchemaResolver.Unwrap(schema)?.Default;
        if (defaultValue == null) {
            defaultToken = JValue.CreateNull();
            return false;
        }

        defaultToken = defaultValue switch {
            JToken token => token.DeepClone(),
            _ => JToken.FromObject(defaultValue)
        };
        return true;
    }

    private static bool ShouldPreserveProperty(string propertyName) =>
        string.Equals(propertyName, "$schema", StringComparison.Ordinal) ||
        propertyName.StartsWith("$", StringComparison.Ordinal);
}
