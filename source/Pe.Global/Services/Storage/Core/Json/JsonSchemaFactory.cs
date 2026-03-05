using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.Global.PolyFill;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     Factory for creating JSON schemas with standardized processor configuration.
///     Supports schema generation and schema injection for settings files. 
/// </summary>
public static class JsonSchemaFactory {
    private static readonly ConcurrentDictionary<string, string> _schemaHashesByPath =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    ///     Creates an authoring schema for local files/tooling scenarios.
    /// </summary>
    public static JsonSchema CreateAuthoringSchema<T>(out SchemaExamplesProcessor examplesProcessor) =>
        CreateAuthoringSchema(typeof(T), out examplesProcessor);

    /// <summary>
    ///     Creates an authoring schema for local files/tooling scenarios (non-generic overload).
    /// </summary>
    public static JsonSchema CreateAuthoringSchema(Type type, out SchemaExamplesProcessor examplesProcessor) =>
        CreateSchema(type, out examplesProcessor);

    /// <summary>
    ///     Creates a frontend render schema optimized for UI generation.
    /// </summary>
    public static JsonSchema CreateRenderSchema<T>(out SchemaExamplesProcessor examplesProcessor) =>
        CreateRenderSchema(typeof(T), out examplesProcessor);

    /// <summary>
    ///     Creates a frontend render schema optimized for UI generation (non-generic overload).
    /// </summary>
    public static JsonSchema CreateRenderSchema(Type type, out SchemaExamplesProcessor examplesProcessor) {
        var renderJson = CreateRenderSchemaJson(type, out examplesProcessor);
        return JsonSchema.FromJsonAsync(renderJson).GetAwaiter().GetResult();
    }

    /// <summary>
    ///     Creates frontend render schema JSON optimized for UI generation.
    /// </summary>
    public static string CreateRenderSchemaJson(Type type, out SchemaExamplesProcessor examplesProcessor) {
        var authoringSchema = CreateAuthoringSchema(type, out examplesProcessor);
        examplesProcessor.Finalize(authoringSchema);
        return RenderSchemaTransformer.TransformToJson(authoringSchema, type);
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
        var itemSchema = CreateAuthoringSchema(itemType, out examplesProcessor);
        // Finalization is intentionally caller-owned to keep fragment and root
        // schema lifecycles explicit and avoid duplicating definition wiring.

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
        settings.SchemaProcessors.Add(new PresettableSchemaProcessor());

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
    /// <param name="schemaFilePath">Absolute file path where the schema should be written</param>
    /// <returns>Modified JSON content with $schema property</returns>
    public static string WriteAndInjectSchema(
        JsonSchema fullSchema,
        string jsonContent,
        string targetFilePath,
        string schemaFilePath
    ) {
        // Ensure directories exist
        var targetDir = Path.GetDirectoryName(targetFilePath);
        if (targetDir != null && !Directory.Exists(targetDir))
            _ = Directory.CreateDirectory(targetDir);
        var normalizedSchemaFilePath = Path.GetFullPath(schemaFilePath);
        var schemaDirectory = Path.GetDirectoryName(normalizedSchemaFilePath)
                              ?? throw new ArgumentException("Schema path must include a directory.", nameof(schemaFilePath));
        if (!Directory.Exists(schemaDirectory))
            _ = Directory.CreateDirectory(schemaDirectory);

        // Write schema only when content changed to reduce I/O churn.
        var schemaJson = EnsureTrailingNewline(fullSchema.ToJson());
        WriteIfChanged(normalizedSchemaFilePath, schemaJson);

        // Calculate relative path from target file to schema
        var relativeSchemaPath = BclExtensions.GetRelativePath(targetDir!, normalizedSchemaFilePath);
        relativeSchemaPath = NormalizeSchemaReference(relativeSchemaPath);

        // Inject $schema reference
        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath;
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }

    private static void WriteIfChanged(string schemaFilePath, string newContent) {
        var contentHash = ComputeHash(newContent);
        if (_schemaHashesByPath.TryGetValue(schemaFilePath, out var cachedHash) &&
            string.Equals(cachedHash, contentHash, StringComparison.Ordinal) &&
            File.Exists(schemaFilePath))
            return;

        if (File.Exists(schemaFilePath)) {
            var existingContent = File.ReadAllText(schemaFilePath);
            if (string.Equals(existingContent, newContent, StringComparison.Ordinal)) {
                _schemaHashesByPath[schemaFilePath] = contentHash;
                return;
            }
        }

        File.WriteAllText(schemaFilePath, newContent);
        _schemaHashesByPath[schemaFilePath] = contentHash;
    }

    private static string NormalizeSchemaReference(string relativeSchemaPath) {
        var normalizedPath = relativeSchemaPath.Replace("\\", "/");
        if (normalizedPath.StartsWith("./", StringComparison.Ordinal) ||
            normalizedPath.StartsWith("../", StringComparison.Ordinal))
            return normalizedPath;
        return $"./{normalizedPath}";
    }

    private static string ComputeHash(string content) {
        using var hashAlgorithm = SHA256.Create();
        var bytes = hashAlgorithm.ComputeHash(Encoding.UTF8.GetBytes(content));
        return BitConverter.ToString(bytes).Replace("-", string.Empty);
    }

    private static string EnsureTrailingNewline(string jsonContent) =>
        jsonContent.TrimEnd('\r', '\n') + Environment.NewLine;
}