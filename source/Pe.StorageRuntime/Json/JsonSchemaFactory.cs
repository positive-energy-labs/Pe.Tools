using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Json.SchemaProcessors;
using Pe.StorageRuntime.PolyFill;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Pe.StorageRuntime.Json;

public sealed class JsonSchemaBuildOptions(
    SettingsRuntimeCapabilities capabilities,
    ISettingsDocumentContextAccessor? documentContextAccessor = null
) {
    public SettingsRuntimeCapabilities Capabilities { get; } =
        capabilities ?? throw new ArgumentNullException(nameof(capabilities));

    public ISettingsDocumentContextAccessor? DocumentContextAccessor { get; } = documentContextAccessor;
    public bool ResolveFieldOptionSamples { get; init; } = true;

    public FieldOptionsExecutionContext CreateFieldOptionsExecutionContext(
        IReadOnlyDictionary<string, string>? fieldValues = null
    ) => new(
        this.Capabilities,
        this.DocumentContextAccessor,
        fieldValues
    );
}

public sealed record JsonSchemaData(
    string SchemaJson,
    string? FragmentSchemaJson
);

public static class JsonSchemaFactory {
    public static JsonSchema BuildAuthoringSchema(Type type, JsonSchemaBuildOptions options) {
        if (type == null)
            throw new ArgumentNullException(nameof(type));
        if (options == null)
            throw new ArgumentNullException(nameof(options));

        var schema = BuildRawAuthoringSchema(type, options);
        schema = SchemaExampleDefinitionConsolidator.Consolidate(schema);
        return SchemaDefaultInjector.ApplyDefaults(schema, type);
    }

    public static JsonSchema BuildFragmentSchema(Type itemType, JsonSchemaBuildOptions options) {
        if (itemType == null)
            throw new ArgumentNullException(nameof(itemType));
        if (options == null)
            throw new ArgumentNullException(nameof(options));

        var itemSchema = BuildRawAuthoringSchema(itemType, options);
        var fragmentSchema = new JsonSchema { Type = JsonObjectType.Object, AllowAdditionalProperties = false };
        SchemaMetadataProcessor.AllowSchemaProperty(fragmentSchema);

        var itemsProperty = new JsonSchemaProperty {
            Type = JsonObjectType.Array,
            Item = itemSchema,
            IsRequired = true
        };
        fragmentSchema.Properties["Items"] = itemsProperty;
        fragmentSchema.RequiredProperties.Add("Items");

        fragmentSchema = SchemaExampleDefinitionConsolidator.Consolidate(fragmentSchema);
        return SchemaDefaultInjector.ApplyFragmentDefaults(fragmentSchema, itemType);
    }

    public static string CreateEditorSchemaJson(Type type, JsonSchemaBuildOptions options) =>
        EditorSchemaTransformer.TransformToEditorJson(BuildAuthoringSchema(type, options));

    public static string CreateEditorFragmentSchemaJson(Type itemType, JsonSchemaBuildOptions options) =>
        EditorSchemaTransformer.TransformFragmentToEditorJson(BuildFragmentSchema(itemType, options));

    public static JsonSchemaData CreateEditorSchemaData(Type type, JsonSchemaBuildOptions options) {
        if (type == null)
            throw new ArgumentNullException(nameof(type));
        if (options == null)
            throw new ArgumentNullException(nameof(options));

        var schemaJson = CreateEditorSchemaJson(type, options);
        string? fragmentSchemaJson = null;

        try {
            fragmentSchemaJson = CreateEditorFragmentSchemaJson(type, options);
        } catch {
        }

        return new JsonSchemaData(schemaJson, fragmentSchemaJson);
    }



    private static JsonSchema BuildRawAuthoringSchema(Type type, JsonSchemaBuildOptions options) {
        var settings = CreateGeneratorSettings(options);
        var schema = new JsonSchemaGenerator(settings).Generate(type);
        SchemaMetadataProcessor.AllowSchemaProperty(schema);
        return schema;
    }

    private static NewtonsoftJsonSchemaGeneratorSettings CreateGeneratorSettings(JsonSchemaBuildOptions options) {
        var settings = new NewtonsoftJsonSchemaGeneratorSettings {
            FlattenInheritanceHierarchy = true,
            AlwaysAllowAdditionalObjectProperties = false
        };

        foreach (var mapper in JsonTypeSchemaBindingRegistry.Shared.CreateTypeMappers())
            settings.TypeMappers.Add(mapper);

        settings.SchemaProcessors.Add(new SchemaOneOfProcessor());
        settings.SchemaProcessors.Add(new JsonTypeSchemaBindingProcessor(options));
        settings.SchemaProcessors.Add(new SchemaIncludesProcessor());
        settings.SchemaProcessors.Add(new SchemaPresetsProcessor());
        settings.SchemaProcessors.Add(new SchemaDefinitionProcessor(options));

        return settings;
    }
}

public static class JsonSchemaDocumentService {
    private static readonly ConcurrentDictionary<string, string> SchemaHashesByPath =
        new(StringComparer.OrdinalIgnoreCase);

    public static void WriteSchemaFile(JsonSchema schema, string schemaFilePath) {
        if (schema == null)
            throw new ArgumentNullException(nameof(schema));
        if (string.IsNullOrWhiteSpace(schemaFilePath))
            throw new ArgumentException("Schema file path is required.", nameof(schemaFilePath));

        var normalizedSchemaFilePath = Path.GetFullPath(schemaFilePath);
        var schemaDirectory = Path.GetDirectoryName(normalizedSchemaFilePath)
                              ?? throw new ArgumentException(
                                  "Schema path must include a directory.",
                                  nameof(schemaFilePath)
                              );
        if (!Directory.Exists(schemaDirectory))
            _ = Directory.CreateDirectory(schemaDirectory);

        var schemaJson = JsonFormatting.NormalizeTrailingNewline(schema.ToJson());
        WriteIfChanged(normalizedSchemaFilePath, schemaJson);
    }

    public static string InjectSchemaReference(
        string jsonContent,
        string targetFilePath,
        string schemaFilePath
    ) {
        if (string.IsNullOrWhiteSpace(jsonContent))
            throw new ArgumentException("JSON content is required.", nameof(jsonContent));
        if (string.IsNullOrWhiteSpace(targetFilePath))
            throw new ArgumentException("Target file path is required.", nameof(targetFilePath));
        if (string.IsNullOrWhiteSpace(schemaFilePath))
            throw new ArgumentException("Schema file path is required.", nameof(schemaFilePath));

        var targetDir = Path.GetDirectoryName(targetFilePath);
        if (targetDir != null && !Directory.Exists(targetDir))
            _ = Directory.CreateDirectory(targetDir);

        var normalizedSchemaFilePath = Path.GetFullPath(schemaFilePath);
        var relativeSchemaPath = BclExtensions.GetRelativePath(targetDir!, normalizedSchemaFilePath);
        relativeSchemaPath = NormalizeSchemaReference(relativeSchemaPath);

        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath;
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }

    public static string WriteSchemaAndInjectReference(
        JsonSchema schema,
        string jsonContent,
        string targetFilePath,
        string schemaFilePath
    ) {
        WriteSchemaFile(schema, schemaFilePath);
        return InjectSchemaReference(jsonContent, targetFilePath, schemaFilePath);
    }

    private static void WriteIfChanged(string schemaFilePath, string newContent) {
        var contentHash = ComputeHash(newContent);
        if (SchemaHashesByPath.TryGetValue(schemaFilePath, out var cachedHash) &&
            string.Equals(cachedHash, contentHash, StringComparison.Ordinal) &&
            File.Exists(schemaFilePath))
            return;

        if (File.Exists(schemaFilePath)) {
            var existingContent = File.ReadAllText(schemaFilePath);
            if (string.Equals(existingContent, newContent, StringComparison.Ordinal)) {
                SchemaHashesByPath[schemaFilePath] = contentHash;
                return;
            }
        }

        File.WriteAllText(schemaFilePath, newContent);
        SchemaHashesByPath[schemaFilePath] = contentHash;
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


}
