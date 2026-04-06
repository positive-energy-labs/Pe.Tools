using NJsonSchema;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

public static class SchemaMetadataProcessor {
    public static void AllowSchemaProperty(JsonSchema schema) =>
        schema.Properties["$schema"] = new JsonSchemaProperty {
            Type = JsonObjectType.String, Description = "URI of the JSON Schema reference", IsRequired = false
        };
}