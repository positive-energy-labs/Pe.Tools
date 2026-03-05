using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.Global.Services.Storage.Core;
using Pe.Global.Services.Storage.Core.Json.ContractResolvers;
using System.Reflection;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     JSON file handler supporting composition, schema injection, and configurable behaviors.
///     Read-path work is optimized for hot loops by caching per-type schema/metadata
///     and avoiding unnecessary file rewrites.
/// </summary>
public sealed class ComposableJson<T> : JsonReadWriter<T> where T : class, new() {
    private static readonly Lazy<TypeMetadata> _cachedTypeMetadata = new(CreateTypeMetadata, isThreadSafe: true);
    private static readonly bool _strictPreComposeValidation =
        IsEnabled(Environment.GetEnvironmentVariable("PE_COMPOSABLEJSON_STRICT_PREVALIDATE"));

    private readonly string _schemaDirectory;
    private readonly JsonBehavior _behavior;
    private readonly JsonCompositionPipeline _compositionPipeline;
    private readonly string _profileSchemaPath;
    private readonly IReadOnlyDictionary<string, Type> _fragmentItemTypesByRoot;
    private readonly IReadOnlyDictionary<string, Type> _presetObjectTypesByRoot;
    private readonly IReadOnlyCollection<string> _knownIncludeRoots;
    private readonly IReadOnlyCollection<string> _knownPresetRoots;
    private readonly JsonSerializer _deserializer;
    private readonly JsonSerializerSettings _deserialSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RevitTypeContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };
    private readonly JsonSerializerSettings _serialSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RequiredAwareContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };


    private bool _fragmentScaffoldingEnsured;
    private DateTimeOffset _cachedModifiedUtc;
    private T? _cachedData;

    public ComposableJson(string filePath, string schemaDirectory, JsonBehavior behavior) {
        this.FilePath = filePath;
        this._schemaDirectory = schemaDirectory;
        this._behavior = behavior;
        var metadata = _cachedTypeMetadata.Value;
        this._fragmentItemTypesByRoot = metadata.FragmentItemTypesByRoot;
        this._presetObjectTypesByRoot = metadata.PresetObjectTypesByRoot;
        this._knownIncludeRoots = metadata.KnownIncludeRoots;
        this._knownPresetRoots = metadata.KnownPresetRoots;
        this._deserializer = JsonSerializer.Create(this._deserialSettings);
        this._profileSchemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(this._schemaDirectory, typeof(T));
        this._compositionPipeline = new JsonCompositionPipeline(
            this._schemaDirectory,
            this._behavior,
            this._fragmentItemTypesByRoot,
            this._presetObjectTypesByRoot,
            this._knownIncludeRoots,
            this._knownPresetRoots
        );
        this.EnsureFragmentScaffolding();
    }

    public string FilePath { get; }

    public T Read() {
        this.EnsureFileExists();

        var content = File.ReadAllText(this.FilePath);
        var originalObject = JObject.Parse(content);
        var workingObject = JObject.Parse(content);
        var authoringSchema = (JsonSchema?)null;

        if (this._behavior != JsonBehavior.Output) {
            authoringSchema = CreateAuthoringSchema();
            var shouldRunPreComposeValidation = _strictPreComposeValidation || ContainsDirectiveMetadata(workingObject);
            if (shouldRunPreComposeValidation) {
                var preValidatedObject = (JObject)workingObject.DeepClone();
                _ = preValidatedObject.Remove("$schema");
                this.ValidateOrThrow(preValidatedObject, authoringSchema);
            }
            workingObject = this._compositionPipeline.ComposeForRead(workingObject);
        }

        _ = workingObject.Remove("$schema");
        this.ValidateOrThrow(workingObject, authoringSchema);
        var result = this.Deserialize(workingObject);

        _ = this.WriteObjectWithSchema(originalObject, authoringSchema);

        this.UpdateCache(result);
        return result;
    }

    public string Write(T data) {
        var authoringSchema = this._behavior == JsonBehavior.Output
            ? null : CreateAuthoringSchema();
        _ = this.WriteWithSchema(data, authoringSchema);
        this.UpdateCache(data);
        return this.FilePath;
    }

    public bool IsCacheValid(int maxAgeMinutes, Func<T, bool>? contentValidator = null) {
        if (this._cachedData == null)
            return false;

        if (!File.Exists(this.FilePath))
            return false;

        var fileModified = new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero);
        if (fileModified > this._cachedModifiedUtc)
            return false;

        var age = DateTimeOffset.UtcNow - this._cachedModifiedUtc;
        if (age.TotalMinutes > maxAgeMinutes)
            return false;

        if (contentValidator != null && !contentValidator(this._cachedData))
            return false;

        return true;
    }

    private void EnsureFileExists() {
        if (File.Exists(this.FilePath))
            return;

        var defaultInstance = new T();
        var authoringSchema = this._behavior == JsonBehavior.Output
            ? null
            : CreateAuthoringSchema();
        _ = this.WriteWithSchema(defaultInstance, authoringSchema);

        if (this._behavior == JsonBehavior.Settings) {
            throw new FileNotFoundException(
                $"""
                Settings file not found: {this.FilePath}
                A default file has been created for your review.
                Please configure the settings and restart the application.
                """);
        }
    }

    private string WriteWithSchema(T data, JsonSchema? authoringSchema = null) {
        var jsonContent = this.Serialize(data);

        if (this._behavior != JsonBehavior.Output) {
            var schema = authoringSchema ?? CreateAuthoringSchema();
            jsonContent = JsonSchemaFactory.WriteAndInjectSchema(schema, jsonContent, this.FilePath, this._profileSchemaPath);
        }

        var directory = Path.GetDirectoryName(this.FilePath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            _ = Directory.CreateDirectory(directory);

        jsonContent = EnsureTrailingNewline(jsonContent);
        File.WriteAllText(this.FilePath, jsonContent);
        return jsonContent;
    }

    private string WriteObjectWithSchema(JObject data, JsonSchema? authoringSchema = null) {
        var jsonContent = data.ToString(Formatting.Indented);
        if (this._behavior != JsonBehavior.Output) {
            var schema = authoringSchema ?? CreateAuthoringSchema();
            jsonContent = JsonSchemaFactory.WriteAndInjectSchema(schema, jsonContent, this.FilePath, this._profileSchemaPath);
        }

        var directory = Path.GetDirectoryName(this.FilePath);
        if (!string.IsNullOrEmpty(directory) && !Directory.Exists(directory))
            _ = Directory.CreateDirectory(directory);

        jsonContent = EnsureTrailingNewline(jsonContent);
        File.WriteAllText(this.FilePath, jsonContent);
        return jsonContent;
    }

    private string Serialize(T data) =>
        JsonConvert.SerializeObject(data, this._serialSettings);

    private T Deserialize(JObject data) =>
        data.ToObject<T>(this._deserializer) ?? new T();

    private void ValidateOrThrow(JObject jObject, JsonSchema? authoringSchema = null) {
        if (this._behavior == JsonBehavior.Output)
            return;

        var schema = authoringSchema ?? CreateAuthoringSchema();
        var validationErrors = schema.Validate(jObject).ToList();
        if (validationErrors.Count > 0)
            throw new JsonValidationException(this.FilePath, validationErrors);
    }

    private static JsonSchema CreateAuthoringSchema() {
        var schema = JsonSchemaFactory.CreateAuthoringSchema<T>(out var examplesProcessor);
        examplesProcessor.Finalize(schema);
        return schema;
    }

    private void EnsureFragmentScaffolding() {
        if (this._fragmentScaffoldingEnsured || this._behavior == JsonBehavior.Output)
            return;

        var globalFragmentsDirectory = SettingsPathing.TryResolveGlobalFragmentsDirectory(this._schemaDirectory);
        foreach (var (fragmentRoot, _) in this._fragmentItemTypesByRoot) {
            this.EnsureFragmentRootScaffold(Path.Combine(this._schemaDirectory, fragmentRoot));
            if (!string.IsNullOrWhiteSpace(globalFragmentsDirectory))
                this.EnsureFragmentRootScaffold(Path.Combine(globalFragmentsDirectory, fragmentRoot));
        }
        foreach (var (presetRoot, _) in this._presetObjectTypesByRoot) {
            this.EnsurePresetRootScaffold(Path.Combine(this._schemaDirectory, presetRoot));
            if (!string.IsNullOrWhiteSpace(globalFragmentsDirectory))
                this.EnsurePresetRootScaffold(Path.Combine(globalFragmentsDirectory, presetRoot));
        }

        this._fragmentScaffoldingEnsured = true;
    }

    private void EnsureFragmentRootScaffold(string fragmentRootDirectory) {
        if (!Directory.Exists(fragmentRootDirectory))
            _ = Directory.CreateDirectory(fragmentRootDirectory);
    }

    private void EnsurePresetRootScaffold(string presetRootDirectory) {
        if (!Directory.Exists(presetRootDirectory))
            _ = Directory.CreateDirectory(presetRootDirectory);
    }

    private static void IndexIncludableRoots(
        Type type,
        HashSet<Type> visitedTypes,
        Dictionary<string, Type> fragmentItemTypesByRoot,
        HashSet<string> knownIncludeRoots
    ) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr != null && TryGetCollectionItemType(property.PropertyType, out var itemType)) {
                var rawRoot = includableAttr.FragmentSchemaName ?? property.Name.ToLowerInvariant();
                var normalizedRoot = NormalizeFragmentRoot(rawRoot);
                _ = knownIncludeRoots.Add(normalizedRoot);
                if (fragmentItemTypesByRoot.TryGetValue(normalizedRoot, out var existingType) && existingType != itemType) {
                    throw new InvalidOperationException(
                        $"Includable root '{normalizedRoot}' maps to multiple fragment item types: '{existingType.Name}' and '{itemType!.Name}'.");
                }

                fragmentItemTypesByRoot[normalizedRoot] = itemType!;
            }

            var nestedType = UnwrapComplexType(property.PropertyType);
            if (nestedType != null)
                IndexIncludableRoots(nestedType, visitedTypes, fragmentItemTypesByRoot, knownIncludeRoots);
        }
    }

    private static void IndexPresettableRoots(
        Type type,
        HashSet<Type> visitedTypes,
        Dictionary<string, Type> presetObjectTypesByRoot,
        HashSet<string> knownPresetRoots
    ) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var presettableAttr = property.GetCustomAttribute<PresettableAttribute>();
            var nestedType = UnwrapComplexType(property.PropertyType);

            if (presettableAttr != null) {
                if (nestedType == null)
                    throw new InvalidOperationException(
                        $"[Presettable] can only be applied to complex object properties. Property '{type.Name}.{property.Name}' is not a complex object.");

                var normalizedRoot = NormalizeFragmentRoot(presettableAttr.FragmentSchemaName);
                _ = knownPresetRoots.Add(normalizedRoot);
                if (presetObjectTypesByRoot.TryGetValue(normalizedRoot, out var existingType) && existingType != nestedType) {
                    throw new InvalidOperationException(
                        $"Preset root '{normalizedRoot}' maps to multiple object types: '{existingType.Name}' and '{nestedType.Name}'.");
                }

                presetObjectTypesByRoot[normalizedRoot] = nestedType;
            }

            if (nestedType != null)
                IndexPresettableRoots(nestedType, visitedTypes, presetObjectTypesByRoot, knownPresetRoots);
        }
    }

    private static bool TryGetCollectionItemType(Type type, out Type? itemType) {
        itemType = null;
        if (type.IsArray) {
            itemType = type.GetElementType();
            return itemType != null;
        }

        if (!type.IsGenericType)
            return false;

        var genericType = type.GetGenericTypeDefinition();
        if (genericType != typeof(List<>) &&
            genericType != typeof(IList<>) &&
            genericType != typeof(ICollection<>) &&
            genericType != typeof(IEnumerable<>)) {
            return false;
        }

        itemType = type.GetGenericArguments()[0];
        return true;
    }

    private static Type? UnwrapComplexType(Type propertyType) {
        var unwrapped = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (TryGetCollectionItemType(unwrapped, out var listItemType) && listItemType != null)
            unwrapped = listItemType;

        if (unwrapped == typeof(string) || unwrapped.IsPrimitive || unwrapped.IsEnum)
            return null;

        return unwrapped.IsClass ? unwrapped : null;
    }

    private static string NormalizeFragmentRoot(string rawRoot) =>
        IncludableFragmentRoots.NormalizeRoot(rawRoot);

    private static TypeMetadata CreateTypeMetadata() {
        var fragmentItemTypesByRoot = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase);
        var presetObjectTypesByRoot = new Dictionary<string, Type>(StringComparer.OrdinalIgnoreCase);
        var knownIncludeRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var knownPresetRoots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IndexIncludableRoots(typeof(T), [], fragmentItemTypesByRoot, knownIncludeRoots);
        IndexPresettableRoots(typeof(T), [], presetObjectTypesByRoot, knownPresetRoots);

        return new TypeMetadata(
            fragmentItemTypesByRoot,
            presetObjectTypesByRoot,
            knownIncludeRoots,
            knownPresetRoots
        );
    }

    private static bool IsEnabled(string? value) {
        if (string.IsNullOrWhiteSpace(value))
            return false;

        return string.Equals(value, "1", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(value, "true", StringComparison.OrdinalIgnoreCase) ||
               string.Equals(value, "yes", StringComparison.OrdinalIgnoreCase);
    }

    private static string EnsureTrailingNewline(string jsonContent) =>
        jsonContent.TrimEnd('\r', '\n') + Environment.NewLine;

    private static bool ContainsDirectiveMetadata(JToken token) {
        if (token is JObject obj) {
            if (obj.Property("$include") != null || obj.Property("$preset") != null)
                return true;

            foreach (var property in obj.Properties()) {
                if (ContainsDirectiveMetadata(property.Value))
                    return true;
            }

            return false;
        }

        if (token is JArray array) {
            foreach (var item in array) {
                if (item != null && ContainsDirectiveMetadata(item))
                    return true;
            }
        }

        return false;
    }

    private void UpdateCache(T data) {
        this._cachedData = data;
        this._cachedModifiedUtc = File.Exists(this.FilePath)
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero)
            : DateTimeOffset.UtcNow;
    }

    private sealed class TypeMetadata {
        public TypeMetadata(
            IReadOnlyDictionary<string, Type> fragmentItemTypesByRoot,
            IReadOnlyDictionary<string, Type> presetObjectTypesByRoot,
            IReadOnlyCollection<string> knownIncludeRoots,
            IReadOnlyCollection<string> knownPresetRoots
        ) {
            this.FragmentItemTypesByRoot = fragmentItemTypesByRoot;
            this.PresetObjectTypesByRoot = presetObjectTypesByRoot;
            this.KnownIncludeRoots = knownIncludeRoots;
            this.KnownPresetRoots = knownPresetRoots;
        }

        public IReadOnlyDictionary<string, Type> FragmentItemTypesByRoot { get; }
        public IReadOnlyDictionary<string, Type> PresetObjectTypesByRoot { get; }
        public IReadOnlyCollection<string> KnownIncludeRoots { get; }
        public IReadOnlyCollection<string> KnownPresetRoots { get; }
    }
}
