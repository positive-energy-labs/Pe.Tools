using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Validation;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.ContractResolvers;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using System.Reflection;
using System.Text.RegularExpressions;

namespace Pe.Global.Services.Storage.Core;

/// <summary>
///     Unified JSON file handler with schema validation and composition support ($include),
///     and behavior-based read/write patterns.
/// </summary>
/// <remarks>
///     <para>Composition features:</para>
///     <list type="bullet">
///         <item><c>$include</c>: Compose arrays from reusable fragment files</item>
///     </list>
///     <para>Behavior modes:</para>
///     <list type="bullet">
///         <item>Settings: crash if missing (creates default for review), sanitize on read</item>
///         <item>State: create default silently, full read/write with schema</item>
///         <item>Output: write-only, no schema injection</item>
///     </list>
/// </remarks>
public class ComposableJson<T> : JsonReader<T>, JsonWriter<T>, JsonReadWriter<T> where T : class, new() {
    private readonly JsonBehavior _behavior;

    private readonly JsonSerializerSettings _deserialSettings = new() {
        Formatting = Formatting.Indented,
        Converters = new List<JsonConverter> { new StringEnumConverter() },
        ContractResolver = new RevitTypeContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };

    private readonly JsonSchema _fullSchema;
    private readonly string _schemaDirectory;

    private readonly JsonSerializerSettings _serialSettings = new() {
        Formatting = Formatting.Indented,
        Converters = new List<JsonConverter> { new StringEnumConverter() },
        ContractResolver = new RequiredAwareContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };

    public ComposableJson(string filePath, string schemaDirectory, JsonBehavior behavior) {
        FileUtils.ValidateFileNameAndExtension(filePath, "json");
        this.FilePath = filePath;
        this._schemaDirectory = schemaDirectory;
        this._behavior = behavior;

        _ = this.EnsureDirectoryExists();

        this._fullSchema = JsonSchemaFactory.CreateSchema<T>(out var examplesProcessor);
        examplesProcessor.Finalize(this._fullSchema);
        SchemaMetadataProcessor.AllowSchemaProperty(this._fullSchema);

        // Generate fragment schemas for any [Includable] properties
        this.GenerateFragmentSchemas();
    }

    private bool FileExists => File.Exists(this.FilePath);

    public string FilePath { get; }

    // ============================================================
    // PUBLIC API - Interface implementations
    // ============================================================

    /// <summary>
    ///     Reads the JSON file, resolving any $include directives.
    ///     Behavior varies by JsonBehavior mode.
    /// </summary>
    public T Read() {
        if (!this.FileExists)
            return this.HandleMissingFile();

        var (jObj, hasIncludes) = this.LoadAndInjectSchema();

        if (!hasIncludes)
            return this.ReadSimple(jObj);

        return this.ReadWithComposition(jObj);
    }

    /// <summary>
    ///     Checks if the cached data is valid based on age and content.
    /// </summary>
    public bool IsCacheValid(int maxAgeMinutes, Func<T, bool>? contentValidator = null) {
        if (!this.FileExists) return false;

        var fileLastWrite = File.GetLastWriteTime(this.FilePath);
        var cacheAge = DateTime.Now - fileLastWrite;

        if (cacheAge.TotalMinutes > maxAgeMinutes) return false;

        if (contentValidator != null) {
            var content = this.Read();
            return contentValidator(content);
        }

        return true;
    }

    /// <summary>
    ///     Writes the data to the JSON file. Returns the file path.
    /// </summary>
    /// <returns>The file path of the written file.</returns>
    public string Write(T data) {
        if (this._behavior == JsonBehavior.Output) {
            // Output mode: no validation, no schema
            this.WriteRaw(data, false);
        } else {
            // Settings/State mode: validate and inject schema
            var jsonContent = this.Serialize(data);
            this.Validate(JObject.Parse(jsonContent));
            this.WriteRaw(data, true);
        }

        return this.FilePath;
    }

    // ============================================================
    // MISSING FILE HANDLERS
    // ============================================================

    private T HandleMissingFile() =>
        this._behavior switch {
            JsonBehavior.Settings => this.HandleMissingSettings(),
            JsonBehavior.State => this.CreateAndReturnDefault(),
            JsonBehavior.Output => throw new InvalidOperationException("Cannot read output-only file"),
            _ => throw new ArgumentOutOfRangeException(nameof(this._behavior))
        };

    private T HandleMissingSettings() {
        var defaultContent = new T();
        this.WriteRaw(defaultContent, true);
        throw new CrashProgramException(
            $"File {this.FilePath} did not exist. A default file was created, please review it and try again.");
    }

    private T CreateAndReturnDefault() {
        var defaultContent = new T();
        this.WriteRaw(defaultContent, true);
        return defaultContent;
    }

    // ============================================================
    // SCHEMA LOADING AND INJECTION
    // ============================================================

    /// <summary>
    ///     Loads the JSON file, detects composition directives, and injects appropriate schema.
    ///     Returns the parsed JObject and include composition flag.
    /// </summary>
    private (JObject jObj, bool hasIncludes) LoadAndInjectSchema() {
        var originalContent = File.ReadAllText(this.FilePath);
        var jObj = JObject.Parse(originalContent);

        // Check for composition directives
        var hasIncludes = this.ContainsIncludeDirectives(jObj);

        // Inject schema reference
        var contentWithSchema = JsonSchemaFactory.WriteAndInjectSchema(
            this._fullSchema, originalContent, this.FilePath, this._schemaDirectory);
        File.WriteAllText(this.FilePath, contentWithSchema);

        // Re-parse after schema injection
        jObj = JObject.Parse(contentWithSchema);

        return (jObj, hasIncludes);
    }

    // ============================================================
    // READ STRATEGIES
    // ============================================================

    /// <summary>
    ///     Reads a file without composition directives.
    ///     Uses behavior-appropriate strategy (sanitize for Settings, simple for others).
    /// </summary>
    private T ReadSimple(JObject jObj) =>
        this._behavior switch {
            JsonBehavior.Settings => this.ReadAndSanitize(jObj),
            _ => this.SimpleRead(jObj)
        };

    private T SimpleRead(JObject jObj) {
        this.Validate(jObj);
        return this.Deserialize(jObj);
    }

    /// <summary>
    ///     Reads a file with composition directives ($include).
    ///     Expands includes and applies sanitization for Settings behavior.
    /// </summary>
    private T ReadWithComposition(JObject jObj) {
        var resolved = jObj;
        // Expand $include directives
        // Use schema directory as base for fragment resolution
        // This ensures fragments are resolved from the root settings directory,
        // not from nested subdirectories like WIP/
        JsonArrayComposer.ExpandIncludes(resolved, this._schemaDirectory, this._schemaDirectory,
            this.GetFragmentSchemaFileName);

        // For Settings behavior, apply sanitization to fix schema drift
        if (this._behavior == JsonBehavior.Settings) return this.SanitizeComposedJson(resolved);

        // For other behaviors, validate and throw on errors
        var validationErrors = this._fullSchema.Validate(resolved).ToList();
        if (validationErrors.Any())
            throw new JsonValidationException(this.FilePath, validationErrors);

        return this.Deserialize(resolved);
    }

    private T ReadAndSanitize(JObject originalJson) {
        // Attempt deserialization with type migrations if needed
        T content;
        try {
            content = this.Deserialize(originalJson);
        } catch (JsonSerializationException ex) {
            var migratedJson = JsonTypeMigrations.TryApplyMigrations(originalJson, ex, out _);
            if (migratedJson != null) {
                File.WriteAllText(this.FilePath, JsonConvert.SerializeObject(migratedJson, Formatting.Indented));
                content = this.Deserialize(migratedJson);
            } else
                throw;
        }

        // Re-serialize to normalize (applies current schema structure)
        // This automatically adds missing properties and removes additional properties
        this.WriteRaw(content, true);
        var updatedJson = JObject.Parse(File.ReadAllText(this.FilePath));

        this.Validate(updatedJson);
        return content;
    }

    private T SanitizeComposedJson(JObject resolvedJson) {
        // Attempt deserialization with type migrations if needed
        T content;
        try {
            content = this.Deserialize(resolvedJson);
        } catch (JsonSerializationException ex) {
            var migratedJson = JsonTypeMigrations.TryApplyMigrations(resolvedJson, ex, out _);
            if (migratedJson != null)
                content = this.Deserialize(migratedJson);
            else
                throw;
        }

        // For composed JSON, we don't write back to the file since the composition
        // is the source of truth. We just validate that the resolved result is valid.
        var jsonContent = this.Serialize(content);
        var updatedJson = JObject.Parse(jsonContent);

        var validationErrors = this._fullSchema.Validate(updatedJson).ToList();
        if (validationErrors.Count == 0) return content;
        throw new JsonValidationException(this.FilePath, validationErrors);
    }

    // ============================================================
    // COMPOSITION RESOLUTION
    // ============================================================

    private bool ContainsIncludeDirectives(JToken token) =>
        token switch {
            JObject obj => obj.Properties().Any(p =>
                p.Name == "$include" || this.ContainsIncludeDirectives(p.Value)),
            JArray arr => arr.Any(this.ContainsIncludeDirectives),
            _ => false
        };


    // ============================================================
    // CORE OPERATIONS
    // ============================================================

    private void Validate(JObject jObject) {
        var errors = this._fullSchema.Validate(jObject).ToList();
        if (errors.Any())
            throw new JsonValidationException(this.FilePath, errors);
    }

    private T Deserialize(JObject jObject) =>
        JsonConvert.DeserializeObject<T>(jObject.ToString(), this._deserialSettings)!;

    private string Serialize(T content) =>
        JsonConvert.SerializeObject(content, this._serialSettings);

    private void WriteRaw(T content, bool injectSchema) {
        _ = this.EnsureDirectoryExists();
        var jsonContent = this.Serialize(content);

        if (injectSchema) {
            jsonContent = JsonSchemaFactory.WriteAndInjectSchema(
                this._fullSchema, jsonContent, this.FilePath, this._schemaDirectory);
        }

        File.WriteAllText(this.FilePath, jsonContent);
    }

    private string EnsureDirectoryExists() {
        var directory = Path.GetDirectoryName(this.FilePath);
        if (directory != null && !Directory.Exists(directory))
            _ = Directory.CreateDirectory(directory);
        return directory!;
    }

    /// <summary>
    ///     Generates fragment schemas for any properties marked with [Includable].
    ///     One schema is generated per unique fragment schema name.
    /// </summary>
    private void GenerateFragmentSchemas() {
        var type = typeof(T);
        var properties = type.GetProperties();
        var generatedSchemaNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in properties) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr == null) continue;

            // Get the item type from List<TItem>
            var propertyType = property.PropertyType;
            if (!propertyType.IsGenericType || propertyType.GetGenericTypeDefinition() != typeof(List<>))
                continue;

            var itemType = propertyType.GetGenericArguments()[0];
            var schemaName = this.GetFragmentSchemaFileName(property.Name);
            if (!generatedSchemaNames.Add(schemaName))
                continue;

            // Generate fragment schema using reflection
            // Get the generic method (the one with no parameters)
            var createFragmentSchemaMethod = typeof(JsonSchemaFactory)
                .GetMethod(nameof(JsonSchemaFactory.CreateFragmentSchema), Type.EmptyTypes)!
                .MakeGenericMethod(itemType);

            var fragmentSchema = (JsonSchema)createFragmentSchemaMethod.Invoke(null, null)!;

            var schemaPath = Path.Combine(this._schemaDirectory, schemaName);

            if (!Directory.Exists(this._schemaDirectory))
                _ = Directory.CreateDirectory(this._schemaDirectory);

            File.WriteAllText(schemaPath, fragmentSchema.ToJson());
        }
    }

    private string GetFragmentSchemaFileName(string? propertyName) {
        if (string.IsNullOrWhiteSpace(propertyName))
            return "schema-fragment.json";

        var property = typeof(T).GetProperty(propertyName,
            BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
        var schemaName = property?.GetCustomAttribute<IncludableAttribute>()?.FragmentSchemaName
                         ?? propertyName.ToLowerInvariant();

        return $"schema-fragment-{schemaName}.json";
    }
}

// ============================================================
// EXTENSION METHODS
// ============================================================

public static class ValidationErrorCollectionExtensions {
    public static bool HasAdditionalPropertiesError(this ICollection<ValidationError> errors) =>
        errors.Any(e => e.Kind == ValidationErrorKind.NoAdditionalPropertiesAllowed);

    public static bool HasPropertyRequiredError(this ICollection<ValidationError> errors) {
        foreach (var error in errors) {
            if (error.Kind == ValidationErrorKind.PropertyRequired) return true;

            if (error is ChildSchemaValidationError childError) {
                foreach (var nestedErrors in childError.Errors.Values) {
                    if (HasPropertyRequiredError(nestedErrors))
                        return true;
                }
            }
        }

        return false;
    }
}

// ============================================================
// FILE-SCOPED HELPERS
// ============================================================

/// <summary>Handles JSON recovery operations for schema validation errors</summary>
file static class JsonRecovery {
    private static readonly HashSet<string> IgnoredProperties = ["$schema"];

    private static List<string> GetAllPropertyPaths(JObject obj, string prefix = "") {
        var paths = new List<string>();
        foreach (var prop in obj.Properties()) {
            if (string.IsNullOrEmpty(prefix) && IgnoredProperties.Contains(prop.Name))
                continue;

            var path = string.IsNullOrEmpty(prefix) ? prop.Name : $"{prefix}.{prop.Name}";
            paths.Add(path);
            if (prop.Value is JObject nestedObj) paths.AddRange(GetAllPropertyPaths(nestedObj, path));
        }

        return paths;
    }

    public static List<string> GetAddedProperties(JObject original, JObject updated) {
        var originalPaths = GetAllPropertyPaths(original);
        var updatedPaths = GetAllPropertyPaths(updated);
        return updatedPaths.Except(originalPaths).ToList();
    }

    public static List<string> GetRemovedProperties(JObject original, JObject updated) {
        var originalPaths = GetAllPropertyPaths(original);
        var updatedPaths = GetAllPropertyPaths(updated);
        return originalPaths.Except(updatedPaths).ToList();
    }
}

/// <summary>Handles automatic type migrations for JSON schema evolution</summary>
file static class JsonTypeMigrations {
    public static JObject TryApplyMigrations(
        JObject json,
        JsonSerializationException exception,
        out List<string> appliedMigrations
    ) {
        appliedMigrations = new List<string>();

        var exceptionMsg = exception.Message;
        var innerMsg = exception.InnerException?.Message ?? "";

        var pathMatch = Regex.Match(exceptionMsg, @"Path '([^']+)'");
        if (!pathMatch.Success) return new JObject();

        var propertyPath = pathMatch.Groups[1].Value;
        var migratedJson = (JObject)json.DeepClone();
        var migrationApplied = false;

        // Migration 1: string → List<string>
        if (innerMsg.Contains("could not cast or convert from System.String to System.Collections.Generic.List") ||
            exceptionMsg.Contains("to type 'System.Collections.Generic.List`1[System.String]'"))
            migrationApplied = ApplyStringToListMigration(migratedJson, propertyPath, appliedMigrations);
        // Migration 2: number → string
        else if (innerMsg.Contains("could not convert from") && innerMsg.Contains("to System.String"))
            migrationApplied = ApplyNumberToStringMigration(migratedJson, propertyPath, appliedMigrations);

        return migrationApplied ? migratedJson : new JObject();
    }

    private static bool ApplyStringToListMigration(JObject json, string path, List<string> appliedMigrations) {
        try {
            var token = json.SelectToken(path);
            if (token == null || token.Type != JTokenType.String) return false;

            var stringValue = token.Value<string>();
            var arrayValue = new JArray { stringValue };

            if (token.Parent is JProperty property) {
                property.Value = arrayValue;
                appliedMigrations.Add(
                    $"Migrated '{path}' from string to array: \"{stringValue}\" → [\"{stringValue}\"]");
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }

    private static bool ApplyNumberToStringMigration(JObject json, string path, List<string> appliedMigrations) {
        try {
            var token = json.SelectToken(path);
            if (token == null || (token.Type != JTokenType.Integer && token.Type != JTokenType.Float)) return false;

            var numValue = token.ToString();
            var stringValue = new JValue(numValue);

            if (token.Parent is JProperty property) {
                property.Value = stringValue;
                appliedMigrations.Add($"Migrated '{path}' from number to string: {numValue} → \"{numValue}\"");
                return true;
            }

            return false;
        } catch {
            return false;
        }
    }
}