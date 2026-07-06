using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using NJsonSchema.NewtonsoftJson.Generation;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;
using Pe.Revit.SettingsRuntime.Json.SchemaProcessors;
using Pe.Shared.StorageRuntime.Capabilities;
using System.Collections.Concurrent;
using System.Globalization;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;

namespace Pe.Revit.SettingsRuntime.Json;

public sealed class JsonSchemaBuildOptions(
    SettingsRuntimeMode runtimeMode
) {
    private readonly ConcurrentDictionary<string, IReadOnlyList<ValueDomainOptionItem>> _valueDomainSampleCache = new(StringComparer.Ordinal);

    public SettingsRuntimeMode RuntimeMode { get; } = runtimeMode;

    public bool ResolveValueDomainSamples { get; init; } = true;

    public ValueDomainExecutionContext CreateValueDomainExecutionContext(
        IReadOnlyDictionary<string, string>? fieldValues = null
    ) => new(
        this.RuntimeMode,
        fieldValues
    );

    public bool TryGetCachedValueDomainSamples(
        string domainKey,
        IReadOnlyDictionary<string, string>? fieldValues,
        out IReadOnlyList<ValueDomainOptionItem> samples
    ) => this._valueDomainSampleCache.TryGetValue(
        CreateValueDomainSampleCacheKey(domainKey, fieldValues),
        out samples!
    );

    public IReadOnlyList<ValueDomainOptionItem> CacheValueDomainSamples(
        string domainKey,
        IReadOnlyDictionary<string, string>? fieldValues,
        IReadOnlyList<ValueDomainOptionItem> samples
    ) {
        var key = CreateValueDomainSampleCacheKey(domainKey, fieldValues);
        this._valueDomainSampleCache[key] = samples;
        return samples;
    }

    private string CreateValueDomainSampleCacheKey(
        string domainKey,
        IReadOnlyDictionary<string, string>? fieldValues
    ) {
        if (fieldValues == null || fieldValues.Count == 0)
            return $"{this.RuntimeMode}:{domainKey}";

        var values = string.Join(
            "|",
            fieldValues
                .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                .Select(pair => $"{pair.Key}={pair.Value}")
        );
        return $"{this.RuntimeMode}:{domainKey}:{values}";
    }
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
        SchemaMetadataProcessor.AllowSchemaProperty(itemSchema);
        var fragmentSchema = new JsonSchema { Type = JsonObjectType.Object, AllowAdditionalProperties = false };
        SchemaMetadataProcessor.AllowSchemaProperty(fragmentSchema);

        var itemsProperty = new JsonSchemaProperty {
            Type = JsonObjectType.Array,
            Item = itemSchema,
            IsRequired = true
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
        return schema;
    }

    private static NewtonsoftJsonSchemaGeneratorSettings CreateGeneratorSettings(JsonSchemaBuildOptions options) {
        var settings = new NewtonsoftJsonSchemaGeneratorSettings {
            FlattenInheritanceHierarchy = true,
            AlwaysAllowAdditionalObjectProperties = false,
            SerializerSettings = new JsonSerializerSettings {
                NullValueHandling = NullValueHandling.Ignore,
                Converters = [new StringEnumConverter()]
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
            if (ShouldRelaxAdditionalProperties(obj)) _ = obj.Remove("additionalProperties");

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

    private sealed class SyntheticPropertyInfo : PropertyInfo {
        private readonly Type propertyType;

        private SyntheticPropertyInfo(Type propertyType) {
            this.propertyType = propertyType;
        }

        public override Type PropertyType => this.propertyType;
        public override PropertyAttributes Attributes => PropertyAttributes.None;
        public override bool CanRead => false;
        public override bool CanWrite => false;
        public override string Name => this.propertyType.Name;
        public override Type DeclaringType => this.propertyType;
        public override Type ReflectedType => this.propertyType;
        public static SyntheticPropertyInfo Create(Type propertyType) => new(propertyType);

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

        public override void SetValue(object? obj, object? value, object?[]? index) =>
            throw new NotSupportedException();

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

// Schemas are served live over HTTP (GET /schemas/settings/...) — the disk-writing
// JsonSchemaDocumentService died with the URL-native move: settings schemas are
// session state (value-domain samples come from the open document) and must not persist.
