using Newtonsoft.Json;
using NJsonSchema;
using NJsonSchema.Generation;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Json.SchemaProviders;
using System.Reflection;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProcessors;

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
[SettingsCapabilityTier(SettingsCapabilityTier.RevitAssembly)]
public class RevitTypeSchemaProcessor(SettingsProviderContext providerContext) : ISchemaProcessor {
    private readonly Dictionary<Type, IOptionsProvider> _providerCache = new();
    private readonly SettingsProviderContext _providerContext =
        providerContext ?? throw new ArgumentNullException(nameof(providerContext));

    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass)
            return;

        var properties = context.ContextualType.Type.GetProperties();
        var actualSchema = context.Schema.HasReference ? context.Schema.Reference : context.Schema;
        if (actualSchema == null)
            return;

        foreach (var property in properties) {
            if (!RevitTypeRegistry.TryGet(property.PropertyType, out var registration) || registration == null)
                continue;

            var propertyName = this.GetJsonPropertyName(property);
            if (!actualSchema.Properties.TryGetValue(propertyName, out var propertySchema))
                continue;

            Type? providerType = null;

            if (registration is { DiscriminatorType: { } discriminatorType, ProviderSelector: { } providerSelector }) {
                var discriminatorAttr = property.GetCustomAttribute(discriminatorType);
                if (discriminatorAttr != null) {
                    var selectedProvider = providerSelector(discriminatorAttr);
                    if (selectedProvider != null)
                        providerType = selectedProvider;
                }
            } else if (registration is { ProviderSelector: { } defaultProviderSelector })
                providerType = defaultProviderSelector(null);

            if (providerType == null)
                continue;

            this.ConvertPropertySchema(propertySchema, registration);
            this.ApplyProviderEnums(propertySchema, providerType);
        }
    }

    private void ConvertPropertySchema(JsonSchema propertySchema, JsonTypeRegistration registration) {
        if (propertySchema.HasReference)
            propertySchema.Reference = null;

        var isNullable = propertySchema.OneOf.Any(schema => schema.Type == JsonObjectType.Null);
        propertySchema.OneOf.Clear();

        propertySchema.Type = isNullable
            ? registration.SchemaType | JsonObjectType.Null
            : registration.SchemaType;

        propertySchema.Properties.Clear();
        propertySchema.AdditionalPropertiesSchema = null;
    }

    private void ApplyProviderEnums(JsonSchema propertySchema, Type providerType) {
        if (!SettingsCapabilityResolver.IsSupported(providerType, this._providerContext.AvailableCapabilityTier))
            return;

        try {
            if (!this._providerCache.TryGetValue(providerType, out var provider)) {
                provider = (IOptionsProvider)Activator.CreateInstance(providerType)!;
                this._providerCache[providerType] = provider;
            }

            var targetSchema = propertySchema.Item ?? propertySchema;
            targetSchema.Enumeration.Clear();
            foreach (var value in provider.GetExamples(this._providerContext))
                targetSchema.Enumeration.Add(value);
        } catch {
        }
    }

    private string GetJsonPropertyName(PropertyInfo property) {
        var jsonPropertyAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
        return jsonPropertyAttr?.PropertyName ?? property.Name;
    }
}
