using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Context;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Json.SchemaProcessors;
using Pe.Shared.StorageRuntime.PolyFill;
using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Shared.StorageRuntime.Json;

public sealed class JsonSchemaBuildOptions(
    SettingsRuntimeMode runtimeMode,
    ISettingsDocumentContextAccessor? documentContextAccessor = null
) {
    public SettingsRuntimeMode RuntimeMode { get; } = runtimeMode;

    public ISettingsDocumentContextAccessor? DocumentContextAccessor { get; } = documentContextAccessor;
    public bool ResolveFieldOptionSamples { get; init; } = true;

    public FieldOptionsExecutionContext CreateFieldOptionsExecutionContext(
        IReadOnlyDictionary<string, string>? fieldValues = null
    ) => new(
        this.RuntimeMode,
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
        schema = SchemaDefaultInjector.ApplyDefaults(schema, type);
        ApplyTypeBinding(type, schema, options);
        JsonTypeSchemaBindingRegistry.Shared.ApplyBindingsToSchema(type, schema, options);
        SchemaMetadataProcessor.AllowSchemaProperty(schema);
        return NormalizeCustomUnionWrappers(schema);
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
            Type = JsonObjectType.Array, Item = itemSchema, IsRequired = true
        };
        fragmentSchema.Properties["Items"] = itemsProperty;
        fragmentSchema.RequiredProperties.Add("Items");
        CopyRootDatasetMetadata(itemSchema, fragmentSchema);

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
        ApplyTypeBinding(type, schema, options);
        SchemaMetadataProcessor.AllowSchemaProperty(schema);
        return schema;
    }

    private static NewtonsoftJsonSchemaGeneratorSettings CreateGeneratorSettings(JsonSchemaBuildOptions options) {
        var settings = new NewtonsoftJsonSchemaGeneratorSettings {
            FlattenInheritanceHierarchy = true,
            AlwaysAllowAdditionalObjectProperties = false,
            SerializerSettings = new JsonSerializerSettings {
                NullValueHandling = NullValueHandling.Ignore, Converters = [new StringEnumConverter()]
            }
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

    private static void ApplyTypeBinding(Type type, JsonSchema schema, JsonSchemaBuildOptions options) {
        var targetType = Nullable.GetUnderlyingType(type) ?? type;
        if (!JsonTypeSchemaBindingRegistry.Shared.TryGet(targetType, out var binding))
            return;

        var actualSchema = schema.HasReference ? schema.Reference : schema;
        if (actualSchema == null)
            return;

        binding.ConfigurePropertySchema(
            actualSchema,
            SyntheticPropertyInfo.Create(targetType),
            options
        );
    }

    private static void CopyRootDatasetMetadata(JsonSchema sourceSchema, JsonSchema targetSchema) {
        var actualSourceSchema = sourceSchema.HasReference ? sourceSchema.Reference : sourceSchema;
        if (actualSourceSchema?.ExtensionData == null ||
            !actualSourceSchema.ExtensionData.TryGetValue("x-data", out var rawRootData))
            return;

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        targetSchema.ExtensionData["x-data"] = rawRootData;
    }

    private static JsonSchema NormalizeCustomUnionWrappers(JsonSchema schema) {
        var root = JObject.Parse(schema.ToJson());
        NormalizeCustomUnionWrappers(root);
        return JsonSchema.FromJsonAsync(root.ToString(Formatting.None)).GetAwaiter().GetResult();
    }

    private static void NormalizeCustomUnionWrappers(JToken token) {
        switch (token) {
            case JObject obj:
                if (ShouldRelaxAdditionalProperties(obj)) {
                    _ = obj.Remove("additionalProperties");
                }

                foreach (var property in obj.Properties().ToArray())
                    NormalizeCustomUnionWrappers(property.Value);

                break;

            case JArray array:
                foreach (var item in array)
                    NormalizeCustomUnionWrappers(item);

                break;
        }
    }

    private static bool ShouldRelaxAdditionalProperties(JObject schemaObject) {
        if (schemaObject["oneOf"] is not JArray oneOf || oneOf.Count == 0)
            return false;

        if (schemaObject["additionalProperties"]?.Type != JTokenType.Boolean ||
            schemaObject["additionalProperties"]!.Value<bool>())
            return false;

        if (schemaObject["properties"] is JObject properties &&
            properties.Properties().Any(property => !string.Equals(property.Name, "$schema", StringComparison.Ordinal)))
            return false;

        return oneOf.All(item =>
            item is JObject branch &&
            (branch["type"]?.Value<string>() == "string" ||
             branch["type"]?.Value<string>() == "object" ||
             branch["$ref"] != null));
    }

    private sealed class SyntheticPropertyInfo(Type propertyType) : PropertyInfo {
        public static SyntheticPropertyInfo Create(Type propertyType) => new(propertyType);

        public override Type PropertyType { get; } = propertyType;
        public override PropertyAttributes Attributes => PropertyAttributes.None;
        public override bool CanRead => false;
        public override bool CanWrite => false;
        public override string Name => propertyType.Name;
        public override Type DeclaringType => propertyType;
        public override Type ReflectedType => propertyType;

        public override MethodInfo[] GetAccessors(bool nonPublic) => [];
        public override MethodInfo? GetGetMethod(bool nonPublic) => null;
        public override ParameterInfo[] GetIndexParameters() => [];
        public override MethodInfo? GetSetMethod(bool nonPublic) => null;
        public override object[] GetCustomAttributes(bool inherit) => [];
        public override object[] GetCustomAttributes(Type attributeType, bool inherit) => [];
        public override bool IsDefined(Type attributeType, bool inherit) => false;
        public override object? GetValue(object? obj, object?[]? index) => throw new NotSupportedException();
        public override object? GetValue(
            object? obj,
            BindingFlags invokeAttr,
            Binder? binder,
            object?[]? index,
            CultureInfo? culture
        ) => throw new NotSupportedException();
        public override void SetValue(object? obj, object? value, object?[]? index) => throw new NotSupportedException();
        public override void SetValue(
            object? obj,
            object? value,
            BindingFlags invokeAttr,
            Binder? binder,
            object?[]? index,
            CultureInfo? culture
        ) => throw new NotSupportedException();
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
