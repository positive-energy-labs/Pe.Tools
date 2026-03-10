using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

/// <summary>
///     Transforms authored schemas into UI-oriented render schemas.
///     Resolves common composition constructs and removes provider-backed examples.
/// </summary>
public static class RenderSchemaTransformer {
    public static string TransformToJson(JsonSchema authoringSchema, Type rootSettingsType) {
        var root = JObject.Parse(authoringSchema.ToJson());
        RemoveProviderExamplesRecursive(root);
        RenderSchemaDefaultInjector.ApplyDefaults(root, rootSettingsType);
        return root.ToString(Formatting.Indented);
    }

    public static string TransformFragmentToJson(JsonSchema fragmentSchema, Type itemType) {
        var root = JObject.Parse(fragmentSchema.ToJson());
        RemoveProviderExamplesRecursive(root);
        RenderSchemaDefaultInjector.ApplyFragmentDefaults(root, itemType);
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
