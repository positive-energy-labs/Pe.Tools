using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

/// <summary>
///     Provider interface for runtime schema examples.
///     Implement this to supply autocomplete suggestions for a property.
/// </summary>
public interface IOptionsProvider {
    IEnumerable<string> GetExamples();
}

/// <summary>
///     Marks a property to receive runtime examples in the JSON schema for LSP autocomplete.
///     Unlike EnumConstraintAttribute, examples are suggestions only - any value is valid.
///     Usage: [SchemaExamples(typeof(MyProvider))]
/// </summary>
[AttributeUsage(AttributeTargets.Property)]
public class SchemaExamplesAttribute : Attribute {
    public SchemaExamplesAttribute(Type providerType) {
        if (!typeof(IOptionsProvider).IsAssignableFrom(providerType)) {
            throw new ArgumentException(
                $"Provider type must implement {nameof(IOptionsProvider)}", nameof(providerType));
        }

        this.ProviderType = providerType;
    }

    public Type ProviderType { get; }
}

/// <summary>
///     Schema processor that injects runtime examples into properties marked with SchemaExamplesAttribute.
///     Examples appear as autocomplete suggestions in LSP without enforcing validation.
///     If ConsolidateDuplicates is true, examples are placed in $defs and referenced via allOf.
///     If false, examples are inlined at each property (classic behavior).
/// </summary>
public class SchemaExamplesProcessor : ISchemaProcessor {
    private readonly Dictionary<Type, List<string>> _providerCache = new();
    private readonly Dictionary<Type, string> _providerToDefName = new();
    private readonly List<(JsonSchema schema, Type providerType)> _trackedSchemas = [];

    /// <summary>
    ///     If true, examples are consolidated to $defs and referenced via allOf.
    ///     If false, examples are inlined at each property. Default: true.
    /// </summary>
    public bool ConsolidateDuplicates { get; init; } = true;

    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass) return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var attr = property.GetCustomAttribute<SchemaExamplesAttribute>();
            if (attr == null) continue;

            var propertyName = GetJsonPropertyName(property);
            var schemaProperties = context.Schema.Properties;
            if (schemaProperties == null || !schemaProperties.TryGetValue(propertyName, out var propSchema)) continue;

            try {
                // Get or create examples for this provider type (cached to avoid duplicate instantiation)
                if (!this._providerCache.TryGetValue(attr.ProviderType, out var examples)) {
                    if (Activator.CreateInstance(attr.ProviderType) is not IOptionsProvider provider) continue;
                    examples = provider.GetExamples().ToList();
                    this._providerCache[attr.ProviderType] = examples;
                }

                // Determine target schema (item schema for arrays, property schema for direct strings)
                var targetSchema = propSchema.Item ?? propSchema;

                if (this.ConsolidateDuplicates) {
                    // Track for later - we'll add $refs in Finalize()
                    this._trackedSchemas.Add((targetSchema, attr.ProviderType));
                } else {
                    // Inline mode: just add examples directly
                    targetSchema.ExtensionData ??= new Dictionary<string, object?>();
                    targetSchema.ExtensionData["examples"] = examples;
                }
            } catch {
                // Fail silently - examples are a nicety, not critical
            }
        }
    }

    /// <summary>
    ///     Call this after schema generation to add $defs and update schemas with references.
    ///     Only does work if ConsolidateDuplicates is true.
    /// </summary>
    public void Finalize(JsonSchema rootSchema) {
        if (!this.ConsolidateDuplicates || !this._trackedSchemas.Any()) return;

        var definitions = rootSchema.Definitions;
        if (definitions == null) return;
        // Create a Definitions entry for each unique provider type
        var defCounter = 0;
        foreach (var (providerType, examples) in this._providerCache) {
            var defName = $"examples_{++defCounter}";
            this._providerToDefName[providerType] = defName;

            // Add examples-only schema to Definitions
            var examplesSchema = new JsonSchema {
                ExtensionData = new Dictionary<string, object?> { ["examples"] = examples }
            };
            definitions[defName] = examplesSchema;
        }

        // Now update all tracked schemas to reference their provider's definition
        foreach (var (schema, providerType) in this._trackedSchemas) {
            var defName = this._providerToDefName[providerType];

            // Create a reference schema
            var refSchema = new JsonSchema();
            refSchema.Reference = rootSchema.Definitions[defName];

            // Add the reference using AllOf
            schema.AllOf.Add(refSchema);
        }
    }

    private static string GetJsonPropertyName(PropertyInfo property) {
        var jsonPropertyAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
        return jsonPropertyAttr?.PropertyName ?? property.Name;
    }
}