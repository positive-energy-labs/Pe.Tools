using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Factory for creating JSON schemas with standardized processor configuration.
///     Supports dual schema generation for $extends composition pattern.
/// </summary>
public static class JsonSchemaFactory {
    /// <summary>
    ///     Creates both full and extends-relaxed schemas for a type.
    ///     The extends schema has no required properties except $extends itself.
    /// </summary>
    public static (JsonSchema Full, JsonSchema Extends) CreateSchemas<T>() =>
        CreateSchemas(typeof(T), out _);

    /// <summary>
    ///     Creates both full and extends-relaxed schemas for a type (non-generic overload).
    ///     The extends schema has no required properties except $extends itself.
    /// </summary>
    public static (JsonSchema Full, JsonSchema Extends) CreateSchemas(Type type, out SchemaExamplesProcessor examplesProcessor) {
        var full = CreateSchema(type, out examplesProcessor);
        examplesProcessor.Finalize(full);
        SchemaMetadataProcessor.AllowSchemaProperty(full);
        SchemaMetadataProcessor.AllowExtendsProperty(full);

        // Create extends variant: same schema but only $extends is required
        var extends = CloneAndRelaxRequirements(full);

        return (full, extends);
    }

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
            Type = JsonObjectType.String, IsRequired = false
        };

        // Add Items property (required array of item type)
        var itemsProperty = new JsonSchemaProperty {
            Type = JsonObjectType.Array, Item = itemSchema, IsRequired = true
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
            FlattenInheritanceHierarchy = true, AlwaysAllowAdditionalObjectProperties = false
        };

        // Add individual TypeMappers for each registered Revit type
        foreach (var mapper in RevitTypeRegistry.CreateTypeMappers())
            settings.TypeMappers.Add(mapper);

        examplesProcessor = new SchemaExamplesProcessor();
        settings.SchemaProcessors.Add(new RevitTypeSchemaProcessor());
        settings.SchemaProcessors.Add(new OneOfSchemaProcessor());
        settings.SchemaProcessors.Add(examplesProcessor);
        settings.SchemaProcessors.Add(new IncludableSchemaProcessor());

        return new JsonSchemaGenerator(settings).Generate(type);
    }

    /// <summary>
    ///     Creates a deep clone of the schema with all required properties cleared,
    ///     making only $extends required instead.
    /// </summary>
    private static JsonSchema CloneAndRelaxRequirements(JsonSchema full) {
        // Deep clone via JSON round-trip
        var extendsJson = full.ToJson();
        var extends = JsonSchema.FromJsonAsync(extendsJson).GetAwaiter().GetResult();

        // Clear all required properties at root level
        extends.RequiredProperties.Clear();

        // Make $extends required instead
        if (extends.Properties.TryGetValue("$extends", out var extendsProp)) {
            extendsProp.IsRequired = true;
            extends.RequiredProperties.Add("$extends");
        }

        return extends;
    }

    /// <summary>
    ///     Writes both schema files to disk and injects the appropriate $schema reference
    ///     based on whether the content uses $extends.
    /// </summary>
    /// <param name="fullSchema">The full schema (all required properties)</param>
    /// <param name="extendsSchema">The relaxed schema (only $extends required)</param>
    /// <param name="jsonContent">The JSON content to inject the schema reference into</param>
    /// <param name="targetFilePath">Path to the target JSON file</param>
    /// <param name="schemaDirectory">Directory where schema files should be written</param>
    /// <param name="hasExtends">Whether the content contains $extends directive</param>
    /// <returns>Modified JSON content with $schema property</returns>
    public static string WriteAndInjectSchema(
        JsonSchema fullSchema,
        JsonSchema extendsSchema,
        string jsonContent,
        string targetFilePath,
        string schemaDirectory,
        bool hasExtends
    ) {
        // Ensure directories exist
        var targetDir = Path.GetDirectoryName(targetFilePath);
        if (targetDir != null && !Directory.Exists(targetDir))
            _ = Directory.CreateDirectory(targetDir);
        if (!Directory.Exists(schemaDirectory))
            _ = Directory.CreateDirectory(schemaDirectory);

        // Write both schema files
        var fullSchemaPath = Path.Combine(schemaDirectory, "schema.json");
        var extendsSchemaPath = Path.Combine(schemaDirectory, "schema-extends.json");

        File.WriteAllText(fullSchemaPath, fullSchema.ToJson());
        File.WriteAllText(extendsSchemaPath, extendsSchema.ToJson());

        // Select appropriate schema based on content
        var selectedSchemaPath = hasExtends ? extendsSchemaPath : fullSchemaPath;

        // Calculate relative path from target file to selected schema
        var relativeSchemaPath = Path.GetRelativePath(targetDir!, selectedSchemaPath);

        // Inject $schema reference
        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath.Replace("\\", "/");
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }

    /// <summary>
    ///     Legacy overload for backwards compatibility - writes single schema.
    ///     Use the dual-schema overload for new code.
    /// </summary>
    [Obsolete("Use the dual-schema overload WriteAndInjectSchema(full, extends, ...) instead")]
    public static string WriteAndInjectSchema(
        JsonSchema schema,
        string jsonContent,
        string targetFilePath,
        string schemaRootDirectory
    ) {
        var directory = Path.GetDirectoryName(targetFilePath);
        if (directory != null && !Directory.Exists(directory))
            _ = Directory.CreateDirectory(directory);

        var schemaPath = Path.Combine(schemaRootDirectory, "schema.json");
        File.WriteAllText(schemaPath, schema.ToJson());

        var relativeSchemaPath = Path.GetRelativePath(directory!, schemaPath);

        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath.Replace("\\", "/");
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }
}