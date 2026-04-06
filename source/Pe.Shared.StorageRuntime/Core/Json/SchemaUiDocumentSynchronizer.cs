using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;

namespace Pe.Shared.StorageRuntime.Core.Json;

internal static class SchemaUiDocumentSynchronizer {
    public static void Synchronize(JsonSchema schema, JToken documentToken) {
        if (schema == null)
            throw new ArgumentNullException(nameof(schema));
        if (documentToken == null)
            throw new ArgumentNullException(nameof(documentToken));

        SynchronizeNode(schema, documentToken);
    }

    private static void SynchronizeNode(JsonSchema? schema, JToken token) {
        var effectiveSchema = SchemaDocumentSchemaResolver.ResolveForToken(schema, token);
        if (effectiveSchema == null)
            return;

        if (token is JObject obj) {
            SynchronizeObject(effectiveSchema, obj);
            return;
        }

        if (token is JArray array)
            SynchronizeArray(effectiveSchema, array);
    }

    private static void SynchronizeObject(JsonSchema schema, JObject obj) {
        foreach (var property in obj.Properties().ToList()) {
            if (string.Equals(property.Name, "$schema", StringComparison.Ordinal))
                continue;

            var propertySchema = SchemaDocumentSchemaResolver.ResolveObjectPropertySchema(
                schema,
                obj,
                property.Name
            );
            if (propertySchema == null)
                continue;

            SynchronizeNode(propertySchema, property.Value);
        }
    }

    private static void SynchronizeArray(JsonSchema schema, JArray array) {
        ApplyTableMetadata(schema, array);

        var itemSchema = SchemaDocumentSchemaResolver.ResolveArrayItemSchema(schema, array);
        if (itemSchema == null)
            return;

        foreach (var item in array)
            SynchronizeNode(itemSchema, item);
    }

    private static void ApplyTableMetadata(JsonSchema schema, JArray array) {
        var uiMetadata = TryReadUiMetadata(schema);
        if (!IsTableWithDynamicColumns(uiMetadata))
            return;

        var fixedColumns = uiMetadata!.Behavior?.FixedColumns?.Where(column => !string.IsNullOrWhiteSpace(column))
            .Distinct(StringComparer.Ordinal)
            .ToList() ?? [];
        var fixedColumnSet = new HashSet<string>(fixedColumns, StringComparer.Ordinal);
        var preferredDynamicColumns = uiMetadata.Behavior?.DynamicColumnOrder?.Values?.Where(column => !string.IsNullOrWhiteSpace(column))
            .Distinct(StringComparer.Ordinal)
            .ToList() ?? [];
        var observedDynamicColumns = CollectObservedDynamicColumns(array, fixedColumnSet);
        var resolvedDynamicColumns = MergeDynamicColumns(preferredDynamicColumns, observedDynamicColumns);

        WriteDynamicColumnOrderValues(schema, resolvedDynamicColumns);
        NormalizeRows(array, fixedColumns, resolvedDynamicColumns);
    }

    private static List<string> CollectObservedDynamicColumns(
        JArray array,
        HashSet<string> fixedColumnSet
    ) {
        var observed = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var token in array) {
            if (token is not JObject row)
                continue;

            foreach (var property in row.Properties()) {
                if (fixedColumnSet.Contains(property.Name) || !seen.Add(property.Name))
                    continue;

                observed.Add(property.Name);
            }
        }

        return observed;
    }

    private static List<string> MergeDynamicColumns(
        IReadOnlyList<string> preferredDynamicColumns,
        IReadOnlyList<string> observedDynamicColumns
    ) {
        var merged = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var column in preferredDynamicColumns) {
            if (seen.Add(column))
                merged.Add(column);
        }

        foreach (var column in observedDynamicColumns) {
            if (seen.Add(column))
                merged.Add(column);
        }

        return merged;
    }

    private static void NormalizeRows(
        JArray array,
        IReadOnlyList<string> fixedColumns,
        IReadOnlyList<string> dynamicColumns
    ) {
        var fixedColumnSet = new HashSet<string>(fixedColumns, StringComparer.Ordinal);
        var dynamicColumnSet = new HashSet<string>(dynamicColumns, StringComparer.Ordinal);

        foreach (var token in array) {
            if (token is not JObject row)
                continue;

            var originalProperties = row.Properties().ToList();
            var reordered = new JObject();
            var emitted = new HashSet<string>(StringComparer.Ordinal);

            foreach (var column in fixedColumns) {
                if (!row.TryGetValue(column, StringComparison.Ordinal, out var value))
                    continue;

                reordered.Add(column, value);
                emitted.Add(column);
            }

            foreach (var column in dynamicColumns) {
                if (!row.TryGetValue(column, StringComparison.Ordinal, out var value))
                    continue;

                reordered.Add(column, value);
                emitted.Add(column);
            }

            foreach (var property in originalProperties) {
                if (emitted.Contains(property.Name))
                    continue;

                if (fixedColumnSet.Contains(property.Name) || dynamicColumnSet.Contains(property.Name))
                    continue;

                reordered.Add(property.Name, property.Value);
                emitted.Add(property.Name);
            }

            row.RemoveAll();
            foreach (var property in reordered.Properties().ToList())
                row.Add(property.Name, property.Value);
        }
    }

    private static void WriteDynamicColumnOrderValues(JsonSchema schema, IReadOnlyList<string> values) {
        var uiObject = GetOrCreateUiObject(schema);
        var behavior = GetOrCreateChildObject(uiObject, "behavior");
        var dynamicColumnOrder = GetOrCreateChildObject(behavior, "dynamicColumnOrder");
        dynamicColumnOrder["values"] = values.Count == 0 ? new JArray() : JArray.FromObject(values);
    }

    private static bool IsTableWithDynamicColumns(SchemaUiMetadata? metadata) =>
        metadata?.Renderer == SchemaUiRendererKeys.Table &&
        metadata.Behavior?.DynamicColumnsFromAdditionalProperties == true;

    private static SchemaUiMetadata? TryReadUiMetadata(JsonSchema schema) {
        var uiObject = GetUiObject(schema);
        if (uiObject == null)
            return null;

        return uiObject.ToObject<SchemaUiMetadata>(JsonSerializer.CreateDefault());
    }

    private static JObject GetOrCreateUiObject(JsonSchema schema) {
        schema.ExtensionData ??= new Dictionary<string, object?>();
        if (schema.ExtensionData.TryGetValue("x-ui", out var existing) && existing is JObject existingObject)
            return existingObject;

        var created = new JObject();
        schema.ExtensionData["x-ui"] = created;
        return created;
    }

    private static JObject? GetUiObject(JsonSchema schema) {
        if (schema.ExtensionData == null || !schema.ExtensionData.TryGetValue("x-ui", out var existing))
            return null;

        return existing switch {
            JObject obj => obj,
            _ => JToken.FromObject(existing).Type == JTokenType.Object
                ? (JObject)JToken.FromObject(existing)
                : null
        };
    }

    private static JObject GetOrCreateChildObject(JObject parent, string propertyName) {
        if (parent[propertyName] is JObject existing)
            return existing;

        var created = new JObject();
        parent[propertyName] = created;
        return created;
    }

}
