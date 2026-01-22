using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Validation;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.ContractResolvers;
using System.Text.RegularExpressions;

namespace Pe.Global.Services.Storage.Core;

/// <summary>
///     Unified JSON file handler with schema validation, composition support ($extends/$include),
///     and behavior-based read/write patterns. Replaces both Json&lt;T&gt; and JsonWithExtends&lt;T&gt;.
/// </summary>
/// <remarks>
///     <para>Composition features:</para>
///     <list type="bullet">
///         <item><c>$extends</c>: Inherit from a base profile, with child properties overriding base</item>
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
    private const string ExtendsProperty = "$extends";

    private readonly JsonBehavior _behavior;

    private readonly JsonSerializerSettings _deserialSettings = new() {
        Formatting = Formatting.Indented,
        Converters = new List<JsonConverter> { new StringEnumConverter() },
        ContractResolver = new RevitTypeContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };

    private readonly JsonSchema _extendsSchema;
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

        // Generate both schema variants
        (this._fullSchema, this._extendsSchema) = JsonSchemaFactory.CreateSchemas<T>();

        // Generate fragment schemas for any [Includable] properties
        this.GenerateFragmentSchemas();
    }

    private bool FileExists => File.Exists(this.FilePath);

    public string FilePath { get; }

    // ============================================================
    // PUBLIC API - Interface implementations
    // ============================================================

    /// <summary>
    ///     Reads the JSON file, resolving any $extends and $include directives.
    ///     Behavior varies by JsonBehavior mode.
    /// </summary>
    public T Read() {
        if (!this.FileExists)
            return this.HandleMissingFile();

        var (jObj, hasExtends, hasIncludes) = this.LoadAndInjectSchema();

        if (!hasExtends && !hasIncludes)
            return this.ReadSimple(jObj);

        return this.ReadWithComposition(jObj, hasExtends, hasIncludes);
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
    ///     Returns the parsed JObject and flags indicating composition features.
    /// </summary>
    private (JObject jObj, bool hasExtends, bool hasIncludes) LoadAndInjectSchema() {
        var originalContent = File.ReadAllText(this.FilePath);
        var jObj = JObject.Parse(originalContent);

        // Check for composition directives
        var hasExtends = jObj.TryGetValue(ExtendsProperty, out _);
        var hasIncludes = this.ContainsIncludeDirectives(jObj);

        // Inject appropriate schema reference based on content
        var contentWithSchema = JsonSchemaFactory.WriteAndInjectSchema(
            this._fullSchema, this._extendsSchema, originalContent,
            this.FilePath, this._schemaDirectory, hasExtends);
        File.WriteAllText(this.FilePath, contentWithSchema);

        // Re-parse after schema injection
        jObj = JObject.Parse(contentWithSchema);

        return (jObj, hasExtends, hasIncludes);
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
    ///     Reads a file with composition directives ($extends and/or $include).
    ///     Resolves inheritance, expands includes, and applies sanitization for Settings behavior.
    /// </summary>
    private T ReadWithComposition(JObject jObj, bool hasExtends, bool hasIncludes) {
        // Resolve inheritance if present
        JObject resolved;
        var extendsName = string.Empty;

        if (hasExtends) {
            if (!jObj.TryGetValue(ExtendsProperty, out var extendsToken))
                throw new InvalidOperationException("hasExtends was true but $extends token not found");

            // Validate $extends value
            if (extendsToken.Type != JTokenType.String || string.IsNullOrWhiteSpace(extendsToken.Value<string>()))
                throw JsonExtendsException.InvalidExtendsValue(this.FilePath, extendsToken.Type.ToString());

            extendsName = extendsToken.Value<string>()!;
            var inheritanceChain = new List<string> { Path.GetFileNameWithoutExtension(this.FilePath) };
            resolved = this.ResolveInheritance(this.FilePath, jObj, extendsName, inheritanceChain);
        } else
            resolved = jObj;

        // Expand $include directives
        if (hasIncludes) {
            // Use schema directory as base for fragment resolution
            // This ensures fragments are resolved from the root settings directory,
            // not from nested subdirectories like WIP/
            JsonArrayComposer.ExpandIncludes(resolved, this._schemaDirectory, this._schemaDirectory);
        }

        // For Settings behavior, apply sanitization to fix schema drift
        if (this._behavior == JsonBehavior.Settings) return this.SanitizeComposedJson(resolved, extendsName);

        // For other behaviors, validate and throw on errors
        var validationErrors = this._fullSchema.Validate(resolved).ToList();
        if (validationErrors.Any()) {
            if (extendsName != null) {
                var formattedErrors = ValidationErrorFormatter.Format(validationErrors);
                throw JsonExtendsException.MergedValidationFailed(
                    this.FilePath,
                    this.GetBasePath(this.FilePath, extendsName),
                    string.Join("\n  - ", formattedErrors));
            }

            throw new JsonValidationException(this.FilePath, validationErrors);
        }

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

    private T SanitizeComposedJson(JObject resolvedJson, string extendsName) {
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
        if (extendsName != null) {
            var formattedErrors = ValidationErrorFormatter.Format(validationErrors);
            throw JsonExtendsException.MergedValidationFailed(
                this.FilePath,
                this.GetBasePath(this.FilePath, extendsName),
                string.Join("\n  - ", formattedErrors));
        }

        throw new JsonValidationException(this.FilePath, validationErrors);
    }

    private JObject SanitizeBaseProfile(string basePath, JObject baseJObject) {
        // Attempt deserialization with type migrations if needed
        T content;
        try {
            content = this.Deserialize(baseJObject);
        } catch (JsonSerializationException ex) {
            var migratedJson = JsonTypeMigrations.TryApplyMigrations(baseJObject, ex, out _);
            if (migratedJson != null) {
                File.WriteAllText(basePath, JsonConvert.SerializeObject(migratedJson, Formatting.Indented));
                content = this.Deserialize(migratedJson);
            } else
                throw;
        }

        // Serialize with current schema to add missing properties and remove additional ones
        var jsonContent = this.Serialize(content);

        // Inject schema and write to file
        var contentWithSchema = JsonSchemaFactory.WriteAndInjectSchema(
            this._fullSchema, this._extendsSchema, jsonContent,
            basePath, this._schemaDirectory, false);
        File.WriteAllText(basePath, contentWithSchema);

        // Return the sanitized JObject
        return JObject.Parse(File.ReadAllText(basePath));
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

    private JObject ResolveInheritance(
        string childPath,
        JObject childJObject,
        string extendsName,
        List<string> inheritanceChain
    ) {
        var basePath = this.GetBasePath(childPath, extendsName);

        // Check for circular inheritance
        if (inheritanceChain.Contains(extendsName)) {
            inheritanceChain.Add(extendsName);
            throw JsonExtendsException.CircularInheritance(childPath, inheritanceChain);
        }

        if (!File.Exists(basePath))
            throw JsonExtendsException.BaseNotFound(childPath, extendsName, basePath);

        inheritanceChain.Add(extendsName);

        // Load base profile
        string baseContent;
        JObject baseJObject;
        try {
            baseContent = File.ReadAllText(basePath);
            baseJObject = JObject.Parse(baseContent);
        } catch (Exception ex) {
            throw JsonExtendsException.BaseValidationFailed(childPath, basePath, ex);
        }

        // Check if base also extends something (multi-level inheritance)
        if (baseJObject.TryGetValue(ExtendsProperty, out var baseExtendsToken)) {
            if (baseExtendsToken.Type != JTokenType.String ||
                string.IsNullOrWhiteSpace(baseExtendsToken.Value<string>()))
                throw JsonExtendsException.InvalidExtendsValue(basePath, baseExtendsToken.Type.ToString());

            var baseExtendsName = baseExtendsToken.Value<string>()!;
            baseJObject = this.ResolveInheritance(basePath, baseJObject, baseExtendsName, inheritanceChain);

            // Write schema for this intermediate base file
            var baseWithSchema = JsonSchemaFactory.WriteAndInjectSchema(
                this._fullSchema, this._extendsSchema, baseContent, basePath, this._schemaDirectory, true);
            File.WriteAllText(basePath, baseWithSchema);
        } else {
            // Base has no extends - validate and sanitize if needed
            try {
                var baseErrors = this._fullSchema.Validate(baseJObject).ToList();
                if (baseErrors.Any()) {
                    // For Settings behavior, sanitize the base profile
                    baseJObject = this._behavior == JsonBehavior.Settings
                        ? this.SanitizeBaseProfile(basePath, baseJObject)
                        : throw new JsonValidationException(basePath, baseErrors);
                } else {
                    // Write schema for base file
                    var baseWithSchema = JsonSchemaFactory.WriteAndInjectSchema(
                        this._fullSchema, this._extendsSchema, baseContent, basePath, this._schemaDirectory,
                        false);
                    File.WriteAllText(basePath, baseWithSchema);

                    baseJObject = JObject.Parse(File.ReadAllText(basePath));
                }
            } catch (JsonValidationException) {
                throw;
            } catch (Exception ex) {
                throw JsonExtendsException.BaseValidationFailed(childPath, basePath, ex);
            }
        }

        // Remove $extends from child before merging
        var childForMerge = (JObject)childJObject.DeepClone();
        _ = childForMerge.Remove(ExtendsProperty);

        return JsonMerge.DeepMerge(baseJObject, childForMerge);
    }

    /// <summary>
    ///     Resolves the base profile path from an $extends value.
    ///     Paths are resolved relative to the child file's directory.
    ///     Security: ensures resolved path stays within schema directory.
    /// </summary>
    /// <remarks>
    ///     Examples (child at "WIP/ASHP.json"):
    ///     - "$extends": "MechEquip" → WIP/MechEquip.json
    ///     - "$extends": "../MechEquip" → MechEquip.json (parent directory)
    /// </remarks>
    private string GetBasePath(string childPath, string extendsName) {
        var baseName = extendsName.EndsWith(".json") ? extendsName : $"{extendsName}.json";
        var childDirectory = Path.GetDirectoryName(childPath)!;

        // Resolve relative to child's directory
        var resolved = Path.GetFullPath(Path.Combine(childDirectory, baseName));

        // Security: ensure we don't escape the schema directory
        var schemaRoot = Path.GetFullPath(this._schemaDirectory);
        if (!resolved.StartsWith(schemaRoot, StringComparison.OrdinalIgnoreCase)) {
            throw new InvalidOperationException(
                $"$extends path '{extendsName}' would escape schema directory. " +
                $"Resolved to: {resolved}, Schema root: {schemaRoot}");
        }

        return resolved;
    }

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
                this._fullSchema, this._extendsSchema, jsonContent,
                this.FilePath, this._schemaDirectory, false);
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
    ///     Currently generates a single schema-fragment.json for all fragment types.
    ///     FragmentSchemaName attribute is reserved for future use if multiple fragment types are needed.
    /// </summary>
    private void GenerateFragmentSchemas() {
        var type = typeof(T);
        var properties = type.GetProperties();

        // Find first [Includable] property to generate schema from
        // In practice, there's typically only one fragment type per schema
        foreach (var property in properties) {
            var includableAttr = property.GetCustomAttribute<IncludableAttribute>();
            if (includableAttr == null) continue;

            // Get the item type from List<TItem>
            var propertyType = property.PropertyType;
            if (!propertyType.IsGenericType || propertyType.GetGenericTypeDefinition() != typeof(List<>))
                continue;

            var itemType = propertyType.GetGenericArguments()[0];

            // Generate fragment schema using reflection
            // Get the generic method (the one with no parameters)
            var createFragmentSchemaMethod = typeof(JsonSchemaFactory)
                .GetMethod(nameof(JsonSchemaFactory.CreateFragmentSchema), Type.EmptyTypes)!
                .MakeGenericMethod(itemType);

            var fragmentSchema = (JsonSchema)createFragmentSchemaMethod.Invoke(null, null)!;

            // Write single fragment schema for simplicity
            // Future: could use FragmentSchemaName to generate multiple schemas if needed
            var schemaFileName = "schema-fragment.json";
            var schemaPath = Path.Combine(this._schemaDirectory, schemaFileName);

            if (!Directory.Exists(this._schemaDirectory))
                _ = Directory.CreateDirectory(this._schemaDirectory);

            File.WriteAllText(schemaPath, fragmentSchema.ToJson());

            // Only generate one schema file (use first [Includable] property found)
            break;
        }
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
    private static readonly HashSet<string> IgnoredProperties = ["$schema", "$extends"];

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