using NJsonSchema;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

/// <summary>
///     Schema processor that allows JSON Schema metadata properties like $schema.
///     This modifies the root schema after generation to explicitly allow $schema
///     as a valid property, even when additionalProperties is false.
/// </summary>
public static class SchemaMetadataProcessor {
    /// <summary>
    ///     Adds $schema as an allowed property to the root schema.
    ///     Call this after schema generation.
    /// </summary>
    public static void AllowSchemaProperty(JsonSchema schema) {
        if (!schema.Properties.ContainsKey("$schema")) {
            schema.Properties["$schema"] = new JsonSchemaProperty {
                Type = JsonObjectType.String,
                Description = "URI of the JSON Schema reference",
                IsRequired = false
            };
        }
    }

}