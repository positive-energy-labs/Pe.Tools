using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.SchemaProcessors;
using Pe.StorageRuntime.PolyFill;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProcessors;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;

namespace Pe.StorageRuntime.Json;

public interface IJsonSchemaCapabilityAugmenter {
    void Configure(
        NewtonsoftJsonSchemaGeneratorSettings settings,
        SettingsCapabilityTier availableCapabilityTier,
        SettingsProviderContext providerContext
    );
}

public sealed class JsonSchemaBuildOptions {
    public JsonSchemaBuildOptions(SettingsProviderContext providerContext) {
        this.ProviderContext = providerContext ?? throw new ArgumentNullException(nameof(providerContext));
    }

    public SettingsProviderContext ProviderContext { get; }
    public bool ResolveExamples { get; init; } = true;
}

public static class JsonSchemaFactory {
    private static readonly List<IJsonSchemaCapabilityAugmenter> Augmenters = [];
    private static readonly ConcurrentDictionary<string, string> SchemaHashesByPath =
        new(StringComparer.OrdinalIgnoreCase);
    private static readonly object SyncRoot = new();

    public static void RegisterAugmenter(IJsonSchemaCapabilityAugmenter augmenter) {
        lock (SyncRoot) {
            if (Augmenters.Any(existing => existing.GetType() == augmenter.GetType()))
                return;

            Augmenters.Add(augmenter);
        }
    }

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

    public static string WriteAndInjectSchema(
        JsonSchema fullSchema,
        string jsonContent,
        string targetFilePath,
        string schemaFilePath
    ) {
        var targetDir = Path.GetDirectoryName(targetFilePath);
        if (targetDir != null && !Directory.Exists(targetDir))
            _ = Directory.CreateDirectory(targetDir);
        var normalizedSchemaFilePath = Path.GetFullPath(schemaFilePath);
        var schemaDirectory = Path.GetDirectoryName(normalizedSchemaFilePath)
                              ?? throw new ArgumentException(
                                  "Schema path must include a directory.",
                                  nameof(schemaFilePath)
                              );
        if (!Directory.Exists(schemaDirectory))
            _ = Directory.CreateDirectory(schemaDirectory);

        var schemaJson = EnsureTrailingNewline(fullSchema.ToJson());
        WriteIfChanged(normalizedSchemaFilePath, schemaJson);

        var relativeSchemaPath = BclExtensions.GetRelativePath(targetDir!, normalizedSchemaFilePath);
        relativeSchemaPath = NormalizeSchemaReference(relativeSchemaPath);

        var jObject = JObject.Parse(jsonContent);
        jObject["$schema"] = relativeSchemaPath;
        return JsonConvert.SerializeObject(jObject, Formatting.Indented);
    }

    private static JsonSchema BuildRawAuthoringSchema(Type type, JsonSchemaBuildOptions options) {
        var settings = CreateGeneratorSettings(
            options.ProviderContext,
            options.ResolveExamples
        );
        var schema = new JsonSchemaGenerator(settings).Generate(type);
        SchemaMetadataProcessor.AllowSchemaProperty(schema);
        return schema;
    }

    private static NewtonsoftJsonSchemaGeneratorSettings CreateGeneratorSettings(
        SettingsProviderContext providerContext,
        bool resolveExamples
    ) {
        var settings = new NewtonsoftJsonSchemaGeneratorSettings {
            FlattenInheritanceHierarchy = true,
            AlwaysAllowAdditionalObjectProperties = false
        };
        var availableCapabilityTier = providerContext.AvailableCapabilityTier;

        lock (SyncRoot) {
            foreach (var augmenter in Augmenters)
                augmenter.Configure(settings, availableCapabilityTier, providerContext);
        }

        settings.SchemaProcessors.Add(new SchemaOneOfProcessor());
        settings.SchemaProcessors.Add(new SchemaExamplesProcessor {
            ResolveExamples = resolveExamples,
            AvailableCapabilityTier = availableCapabilityTier,
            ProviderContext = providerContext
        });
        settings.SchemaProcessors.Add(new SchemaIncludesProcessor());
        settings.SchemaProcessors.Add(new SchemaPresetsProcessor());

        return settings;
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

    private static string EnsureTrailingNewline(string jsonContent) =>
        jsonContent.TrimEnd('\r', '\n') + Environment.NewLine;
}
