using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

/// <summary>
///     Unified schema processor that handles all registered Revit-native types.
///     Replaces JsonConverterSchemaProcessor and SchemaEnumProcessor with a single, registry-driven approach.
///     For each property:
///     1. Check if type is registered in RevitTypeRegistry
///     2. If yes, apply schema type (e.g., object → string)
///     3. If type has discriminator, check for attribute and select provider
///     4. If no discriminator, use default provider
///     5. Apply enum values from selected provider
/// </summary>
public class RevitTypeSchemaProcessor : ISchemaProcessor {
    private readonly Dictionary<Type, IOptionsProvider> _providerCache = new();

    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass) return;

        var properties = context.ContextualType.Type.GetProperties();
        var actualSchema = context.Schema.HasReference ? context.Schema.Reference : context.Schema;
        if (actualSchema == null) return;

        foreach (var property in properties) {
            // Check if property type is registered
            if (!RevitTypeRegistry.TryGet(property.PropertyType, out var registration) || registration == null)
                continue;

            var propertyName = this.GetJsonPropertyName(property);
            if (!actualSchema.Properties.TryGetValue(propertyName, out var propertySchema))
                continue;

            // Determine which provider to use
            var providerType = registration.DefaultProvider;

            if (registration.DiscriminatorType is { } discriminatorType &&
                registration.ProviderSelector is { } providerSelector) {
                var discriminatorAttr = property.GetCustomAttribute(discriminatorType);
                if (discriminatorAttr != null) {
                    var selectedProvider = providerSelector(discriminatorAttr);
                    if (selectedProvider != null)
                        providerType = selectedProvider;
                }
            }

            if (providerType == null) continue;

            // Apply schema type transformation (e.g., ForgeTypeId object → string)
            this.ConvertPropertySchema(propertySchema, registration);

            // Apply enum values from provider
            this.ApplyProviderEnums(propertySchema, providerType);
        }
    }

    /// <summary>
    ///     Converts a property schema to the registered JSON Schema type.
    ///     Similar to JsonConverterSchemaProcessor.ConvertPropertySchema but driven by registry.
    /// </summary>
    private void ConvertPropertySchema(JsonSchema propertySchema, TypeRegistration registration) {
        // Clear reference if it exists
        if (propertySchema.HasReference)
            propertySchema.Reference = null;

        // Check if property is nullable
        var isNullable = propertySchema.OneOf.Any(s => s.Type == JsonObjectType.Null);
        propertySchema.OneOf.Clear();

        // Set the schema type
        propertySchema.Type = isNullable
            ? registration.SchemaType | JsonObjectType.Null
            : registration.SchemaType;

        // Clear object-related properties (only relevant if converting from object type)
        propertySchema.Properties.Clear();
        propertySchema.AdditionalPropertiesSchema = null;
    }

    /// <summary>
    ///     Applies enum values from a provider to the schema.
    ///     Similar to SchemaEnumProcessor logic but integrated here.
    /// </summary>
    private void ApplyProviderEnums(JsonSchema propertySchema, Type providerType) {
        try {
            // Get or create provider instance (cached to avoid duplicate instantiation)
            if (!this._providerCache.TryGetValue(providerType, out var provider)) {
                provider = (IOptionsProvider)Activator.CreateInstance(providerType)!;
                this._providerCache[providerType] = provider;
            }

            // Determine target schema (item schema for arrays, property schema for direct values)
            var targetSchema = propertySchema.Item ?? propertySchema;

            // Set enum constraint (clear first to avoid duplicates)
            targetSchema.Enumeration.Clear();
            foreach (var value in provider.GetExamples()) targetSchema.Enumeration.Add(value);
        } catch {
            // Fail silently - enum constraints are a nicety, not critical
        }
    }

    private string GetJsonPropertyName(PropertyInfo property) {
        var jsonPropertyAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
        return jsonPropertyAttr?.PropertyName ?? property.Name;
    }
}