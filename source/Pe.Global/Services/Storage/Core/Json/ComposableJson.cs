using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.Global.Services.Storage.Core.Json.ContractResolvers;
using System.Reflection;

namespace Pe.Global.Services.Storage.Core.Json;

/// <summary>
///     JSON file handler supporting $include composition, schema injection, and configurable behaviors.
/// </summary>
public sealed class ComposableJson<T> : JsonReadWriter<T> where T : class, new() {
    private readonly string _schemaDirectory;
    private readonly JsonBehavior _behavior;
    private readonly Dictionary<string, Type> _fragmentItemTypesByRoot = new(StringComparer.OrdinalIgnoreCase);
    private readonly HashSet<string> _knownFragmentRoots = new(StringComparer.OrdinalIgnoreCase);
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
        this.IndexIncludableRoots(typeof(T), []);
        this.EnsureFragmentScaffolding();
    }

    public string FilePath { get; }

    public T Read() {
        this.EnsureFileExists();

        var content = File.ReadAllText(this.FilePath);
        var originalObject = JObject.Parse(content);
        var expandedObject = (JObject)originalObject.DeepClone();
        var authoringSchema = (JsonSchema?)null;

        if (this._behavior != JsonBehavior.Output) {
            var touchedFragments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var fragmentSchemasByRoot = new Dictionary<string, JsonSchema>(StringComparer.OrdinalIgnoreCase);
            JsonArrayComposer.ExpandIncludes(
                expandedObject,
                Path.GetDirectoryName(this.FilePath)!,
                this._schemaDirectory,
                this._knownFragmentRoots,
                (fragmentPath, includePath) =>
                    this.RewriteIncludedFragmentSchema(fragmentPath, includePath, touchedFragments, fragmentSchemasByRoot)
            );
            authoringSchema = ComposableJson<T>.CreateAuthoringSchema();
        }

        this.ValidateOrThrow(expandedObject, authoringSchema);

        var result = this.Deserialize(expandedObject);

        _ = this.WriteObjectWithSchema(originalObject, authoringSchema);

        this.UpdateCache(result);
        return result;
    }

    public string Write(T data) {
        var authoringSchema = this._behavior == JsonBehavior.Output
            ? null
            : ComposableJson<T>.CreateAuthoringSchema();
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
            : ComposableJson<T>.CreateAuthoringSchema();
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
            var schema = authoringSchema ?? ComposableJson<T>.CreateAuthoringSchema();
            jsonContent = JsonSchemaFactory.WriteAndInjectSchema(schema, jsonContent, this.FilePath, this._schemaDirectory);
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
            var schema = authoringSchema ?? ComposableJson<T>.CreateAuthoringSchema();
            jsonContent = JsonSchemaFactory.WriteAndInjectSchema(schema, jsonContent, this.FilePath, this._schemaDirectory);
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
        data.ToObject<T>(JsonSerializer.Create(this._deserialSettings)) ?? new T();

    private void ValidateOrThrow(JObject jObject, JsonSchema? authoringSchema = null) {
        if (this._behavior == JsonBehavior.Output)
            return;

        var schema = authoringSchema ?? ComposableJson<T>.CreateAuthoringSchema();
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

        foreach (var (fragmentRoot, itemType) in this._fragmentItemTypesByRoot) {
            var fragmentRootDirectory = Path.Combine(this._schemaDirectory, fragmentRoot);
            if (!Directory.Exists(fragmentRootDirectory))
                _ = Directory.CreateDirectory(fragmentRootDirectory);

            var fragmentSchemaPath = Path.Combine(fragmentRootDirectory, "fragment.schema.json");
            if (File.Exists(fragmentSchemaPath))
                continue;

            var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(itemType, out var examplesProcessor);
            examplesProcessor.Finalize(fragmentSchema);
            var fragmentSchemaJson = EnsureTrailingNewline(fragmentSchema.ToJson());
            File.WriteAllText(fragmentSchemaPath, fragmentSchemaJson);
        }

        this._fragmentScaffoldingEnsured = true;
    }

    private void RewriteIncludedFragmentSchema(
        string fragmentPath,
        string includePath,
        HashSet<string> touchedFragments,
        Dictionary<string, JsonSchema> fragmentSchemasByRoot
    ) {
        if (this._behavior == JsonBehavior.Output)
            return;
        if (!touchedFragments.Add(fragmentPath))
            return;

        var rootSegment = includePath.Replace('\\', '/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(rootSegment))
            throw JsonCompositionException.InvalidIncludePath(includePath);
        if (!this._fragmentItemTypesByRoot.TryGetValue(rootSegment, out var itemType))
            throw JsonCompositionException.InvalidIncludePath(includePath);

        var fragmentContent = File.ReadAllText(fragmentPath);
        var fragmentSchemaDirectory = Path.Combine(this._schemaDirectory, rootSegment);
        if (!fragmentSchemasByRoot.TryGetValue(rootSegment, out var fragmentSchema)) {
            fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(itemType, out var fragmentExamplesProcessor);
            fragmentExamplesProcessor.Finalize(fragmentSchema);
            fragmentSchemasByRoot[rootSegment] = fragmentSchema;
        }
        var updatedContent = JsonSchemaFactory.WriteAndInjectSchema(
            fragmentSchema,
            fragmentContent,
            fragmentPath,
            fragmentSchemaDirectory,
            schemaFileName: "fragment.schema.json",
            resolveClosestSchemaDirectory: false
        );
        updatedContent = EnsureTrailingNewline(updatedContent);
        File.WriteAllText(fragmentPath, updatedContent);
    }

    private void IndexIncludableRoots(Type type, HashSet<Type> visitedTypes) {
        if (!visitedTypes.Add(type))
            return;

        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance)) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr != null && TryGetCollectionItemType(property.PropertyType, out var itemType)) {
                var rawRoot = includableAttr.FragmentSchemaName ?? property.Name.ToLowerInvariant();
                var normalizedRoot = NormalizeFragmentRoot(rawRoot);
                _ = this._knownFragmentRoots.Add(normalizedRoot);
                if (this._fragmentItemTypesByRoot.TryGetValue(normalizedRoot, out var existingType) && existingType != itemType) {
                    throw new InvalidOperationException(
                        $"Includable root '{normalizedRoot}' maps to multiple fragment item types: '{existingType.Name}' and '{itemType!.Name}'.");
                }

                this._fragmentItemTypesByRoot[normalizedRoot] = itemType!;
            }

            var nestedType = UnwrapComplexType(property.PropertyType);
            if (nestedType != null)
                this.IndexIncludableRoots(nestedType, visitedTypes);
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

    private static string NormalizeFragmentRoot(string rawRoot) {
        var normalized = rawRoot.Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(normalized))
            throw new InvalidOperationException("Includable fragment root cannot be empty.");
        if (normalized.Contains('/') || normalized == "." || normalized == "..")
            throw new InvalidOperationException($"Invalid includable fragment root '{rawRoot}'.");
        return "_" + normalized;
    }

    private static string EnsureTrailingNewline(string jsonContent) =>
        jsonContent.TrimEnd('\r', '\n') + Environment.NewLine;

    private void UpdateCache(T data) {
        this._cachedData = data;
        this._cachedModifiedUtc = File.Exists(this.FilePath)
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(this.FilePath), TimeSpan.Zero)
            : DateTimeOffset.UtcNow;
    }
}
