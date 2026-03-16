using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

public static class EditorSchemaTransformer {
    public static string TransformToEditorJson(JsonSchema schema) =>
        Transform(schema);

    public static string TransformFragmentToEditorJson(JsonSchema schema) =>
        Transform(schema);

    private static string Transform(JsonSchema schema) {
        var root = JObject.Parse(schema.ToJson());
        RemoveProviderExamplesRecursive(root);
        return root.ToString(Formatting.Indented);
    }

    private static void RemoveProviderExamplesRecursive(JToken token) {
        if (token is JObject obj) {
            if (obj["x-options"] != null)
                _ = obj.Remove("examples");

            foreach (var property in obj.Properties())
                RemoveProviderExamplesRecursive(property.Value);
            return;
        }

        if (token is not JArray array)
            return;

        foreach (var item in array)
            RemoveProviderExamplesRecursive(item);
    }
}
