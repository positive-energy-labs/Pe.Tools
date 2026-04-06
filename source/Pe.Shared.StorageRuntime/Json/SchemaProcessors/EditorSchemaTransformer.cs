using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.Shared.StorageRuntime.Json.SchemaProcessors;

public static class EditorSchemaTransformer {
    public static string TransformToEditorJson(JsonSchema schema) =>
        Transform(schema);

    public static string TransformFragmentToEditorJson(JsonSchema schema) =>
        Transform(schema);

    private static string Transform(JsonSchema schema) {
        var root = JObject.Parse(schema.ToJson());
        return root.ToString(Formatting.Indented);
    }
}