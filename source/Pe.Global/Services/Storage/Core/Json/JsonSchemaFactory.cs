using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Factory for creating JSON schemas with standardized processor configuration.
///     Supports schema generation and schema injection for settings files.
/// </summary>
public static class JsonSchemaFactory {
    /// <summary>
    ///     Creates a fragment schema for array items of type T.
    ///     Fragment files are objects with an "Items" property containing an array of T.
    /// </summary>
    public static JsonSchema CreateFragmentSchema<T>() =>
        CreateFragmentSchema(typeof(T), out _);

    /// <summary>
    ///     Creates a fragment schema for array items (non-generic overload).
    ///     Fragment files are objects with an "Items" property containing an array of the specified type.
    /// </summary>
    public static JsonSchema CreateFragmentSchema(Type itemType, out SchemaExamplesProcessor examplesProcessor) {
        // Create schema for the item type
        var itemSchema = CreateSchema(itemType, out examplesProcessor);
        examplesProcessor.Finalize(itemSchema);

        // Create wrapper schema with Items property
        var fragmentSchema = new JsonSchema { Type = JsonObjectType.Object, AllowAdditionalProperties = false };

        // Add $schema property (optional)
        fragmentSchema.Properties["$schema"] = new JsonSchemaProperty {
            Type = JsonObjectType.String,
            IsRequired = false
        };

        // Add Items property (array of item type)
        var itemsProperty = new JsonSchemaProperty {
            Type = JsonObjectType.Array,
            Item = itemSchema,
            IsRequired = true
        };
        fragmentSchema.Properties["Items"] = itemsProperty;
        fragmentSchema.RequiredProperties.Add("Items");

        return fragmentSchema;
    }

    /// <summary>
    ///     Creates a JSON schema for type T with all standard processors registered.
    ///     Includes RevitTypeSchemaProcessor, OneOfSchemaProcessor, and SchemaExamplesProcessor.
    /// </summary>
    public static JsonSchema CreateSchema<T>(out SchemaExamplesProcessor examplesProcessor) =>
        CreateSchema(typeof(T), out examplesProcessor);

    /// <summary>
    ///     Creates a JSON schema for the specified type with all standard processors registered (non-generic overload).
    ///     Includes RevitTypeSchemaProcessor, OneOfSchemaProcessor, and SchemaExamplesProcessor.
    /// </summary>
    public static JsonSchema CreateSchema(Type type, out SchemaExamplesProcessor examplesProcessor) {
        RevitTypeRegistry.Initialize();

        var settings = new NewtonsoftJsonSchemaGeneratorSettings {
            FlattenInheritanceHierarchy = true,
            AlwaysAllowAdditionalObjectProperties = false
        };

        // Add individual TypeMappers for each registered Revit type
        foreach (var mapper in RevitTypeRegistry.CreateTypeMappers())
            settings.TypeMappers.Add(mapper);

        examplesProcessor = new SchemaExamplesProcessor();
        settings.SchemaProcessors.Add(new RevitTypeSchemaProcessor());
        settings.SchemaProcessors.Add(new OneOfSchemaProcessor());
        settings.SchemaProcessors.Add(examplesProcessor);
        settings.SchemaProcessors.Add(new IncludableSchemaProcessor());

        var schema = new JsonSchemaGenerator(settings).Generate(type);
        SchemaMetadataProcessor.AllowSchemaProperty(schema);
        return schema;
    }

    /// <summary>
    ///     Writes the schema file to disk and injects the $schema reference.
    /// </summary>
    /// <param name="fullSchema">The full schema (all properties)</param>
    /// <param name="jsonContent">The JSON content to inject the schema reference into</param>
    /// <param name="targetFilePath">Path to the target JSON file</param>
    /// <param name="schemaDirectory">Directory where schema files should be written</param>
    /// <returns>Modified JSON content with $schema property</returns>
    public static string WriteAndInjectSchema(
        JsonSchema fullSchema,
        string jsonContent,
        string targetFilePath,
        string schemaDirectory
    ) {
        // Ensure directories exist
        var targetDir = Path.GetDirectoryName(targetFilePath);
        if (targetDir != null && !Directory.Exists(targetDir))
            _ = Directory.CreateDirectory(targetDir);
        if (!Directory.Exists(schemaDirectory))
            _ = Directory.CreateDirectory(schemaDirectory);

        // Write schema file
        var fullSchemaPath = Path.Combine(schemaDirectory, "schema.json");
        File.WriteAllText(fullSchemaPath, fullSchema.ToJson());

        // Calculate relative path from target file to schema
        var relativeSchemaPath = BclExtensions.GetRelativePath(targetDir!, fullSchemaPath);

        // Inject $schema reference
        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath.Replace("\\", "/");
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }
}