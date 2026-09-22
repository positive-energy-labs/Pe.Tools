using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProcessors;

public static class EditorSchemaTransformer {
    public static string TransformToEditorJson(JsonSchema schema) =>
        Transform(schema);

    public static string TransformFragmentToEditorJson(JsonSchema schema) =>
        Transform(schema);

    private static string Transform(JsonSchema schema) {
        var root = JObject.Parse(schema.ToJson());
        NormalizeConstrainedValueDomainSchemas(root);
        return root.ToString(Formatting.Indented);
    }

    private static void NormalizeConstrainedValueDomainSchemas(JToken token) {
        if (token is JObject obj) {
            if (IsConstrainedValueDomainSchema(obj) && HasReferencedValueDomainDefinition(obj)) {
                _ = obj.Remove("examples");
                _ = obj.Remove("enum");
                _ = obj.Remove("x-enumNames");
            }

            foreach (var property in obj.Properties().ToList())
                NormalizeConstrainedValueDomainSchemas(property.Value);

            return;
        }

        if (token is not JArray array)
            return;

        foreach (var item in array)
            NormalizeConstrainedValueDomainSchemas(item);
    }

    private static bool IsConstrainedValueDomainSchema(JObject obj) =>
        obj["x-options"] is JObject options
        && string.Equals(options["mode"]?.Value<string>(), "Constraint", StringComparison.OrdinalIgnoreCase)
        && options["allowsCustomValue"]?.Value<bool>() == false;

    private static bool HasReferencedValueDomainDefinition(JObject obj) =>
        obj["allOf"] is JArray allOf
        && allOf.Children<JObject>()
            .Select(item => item["$ref"]?.Value<string>())
            .Any(reference => !string.IsNullOrWhiteSpace(reference)
                && reference.StartsWith("#/definitions/valueDomain_", StringComparison.Ordinal));
}
