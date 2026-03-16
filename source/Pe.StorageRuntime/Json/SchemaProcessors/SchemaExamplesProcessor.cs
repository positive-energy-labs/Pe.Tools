using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using NJsonSchema.Generation;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.SchemaProviders;
using System.Reflection;

namespace Pe.StorageRuntime.Json.SchemaProcessors;

[AttributeUsage(AttributeTargets.Property)]
public class SchemaExamplesAttribute : Attribute {
    public SchemaExamplesAttribute(Type providerType) {
        if (!typeof(IOptionsProvider).IsAssignableFrom(providerType)) {
            throw new ArgumentException(
                $"Provider type must implement {nameof(IOptionsProvider)}",
                nameof(providerType)
            );
        }

        this.ProviderType = providerType;
    }

    public Type ProviderType { get; }
}

public class SchemaExamplesProcessor : ISchemaProcessor {
    private readonly Dictionary<Type, IReadOnlyList<string>> _dependentProviders = new();
    private readonly Dictionary<Type, List<string>> _providerCache = new();

    public SettingsProviderContext ProviderContext { get; init; } = new(SettingsCapabilityTier.RevitAssembly);
    public bool ResolveExamples { get; init; } = true;

    public void Process(SchemaProcessorContext context) {
        if (!context.ContextualType.Type.IsClass)
            return;

        foreach (var property in context.ContextualType.Type.GetProperties()) {
            var attr = property.GetCustomAttribute<SchemaExamplesAttribute>();
            if (attr == null)
                continue;

            var propertyName = GetJsonPropertyName(property);
            var schemaProperties = context.Schema.Properties;
            if (schemaProperties == null || !schemaProperties.TryGetValue(propertyName, out var propSchema))
                continue;

            var targetSchema = propSchema.Item ?? propSchema;
            if (targetSchema == null)
                continue;

            try {
                if (Activator.CreateInstance(attr.ProviderType) is not IOptionsProvider provider)
                    continue;

                var providerCapabilityTier = SettingsCapabilityResolver.GetRequiredTier(attr.ProviderType);
                var canExecuteProvider = SettingsCapabilityResolver.IsSupported(
                    attr.ProviderType,
                    this.ProviderContext.AvailableCapabilityTier
                );

                if (provider is IDependentOptionsProvider dependentProvider)
                    this._dependentProviders[attr.ProviderType] = dependentProvider.DependsOn;

                List<string>? examples = null;
                if (this.ResolveExamples && canExecuteProvider) {
                    if (!this._providerCache.TryGetValue(attr.ProviderType, out examples)) {
                        examples = provider.GetExamples(this.ProviderContext).ToList();
                        this._providerCache[attr.ProviderType] = examples;
                    }
                }

                var clientHintProvider = provider as IFieldOptionsClientHintProvider;
                var dependsOn = this._dependentProviders.TryGetValue(attr.ProviderType, out var dependencyKeys)
                    ? dependencyKeys
                        .Select(key => new SettingsOptionsDependency(key, GetDependencyScope(key)))
                        .ToList()
                    : [];
                var optionSource = CreateFieldOptionsSource(
                    attr.ProviderType.Name,
                    clientHintProvider?.Resolver ?? SettingsOptionsResolverKind.Remote,
                    clientHintProvider?.Dataset,
                    SettingsOptionsMode.Suggestion,
                    true,
                    dependsOn
                );

                if (this.ResolveExamples && examples != null) {
                    targetSchema.ExtensionData ??= new Dictionary<string, object?>();
                    var existingExamples = targetSchema.ExtensionData.TryGetValue("examples", out var existing) &&
                                           existing is IEnumerable<string> enumerableExamples
                        ? enumerableExamples
                        : [];
                    var merged = existingExamples
                        .Concat(examples)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .ToList();
                    targetSchema.ExtensionData["examples"] = merged;
                }

                targetSchema.ExtensionData ??= new Dictionary<string, object?>();
                targetSchema.ExtensionData["x-options"] = optionSource;
                targetSchema.ExtensionData["x-capability-tier"] = providerCapabilityTier.ToString();
            } catch {
            }
        }
    }

    private static JObject CreateFieldOptionsSource(
        string key,
        SettingsOptionsResolverKind resolver,
        SettingsOptionsDatasetKind? dataset,
        SettingsOptionsMode mode,
        bool allowsCustomValue,
        IReadOnlyCollection<SettingsOptionsDependency> dependsOn
    ) {
        var serializer = JsonSerializer.CreateDefault(new JsonSerializerSettings {
            Converters = [new StringEnumConverter()]
        });
        return new JObject {
            ["key"] = key,
            ["resolver"] = JToken.FromObject(resolver, serializer),
            ["dataset"] = dataset == null ? JValue.CreateNull() : JToken.FromObject(dataset.Value, serializer),
            ["mode"] = JToken.FromObject(mode, serializer),
            ["allowsCustomValue"] = allowsCustomValue,
            ["dependsOn"] = JArray.FromObject(dependsOn, serializer)
        };
    }

    private static SettingsOptionsDependencyScope GetDependencyScope(string key) =>
        string.Equals(key, OptionContextKeys.SelectedFamilyNames, StringComparison.Ordinal) ||
        string.Equals(key, OptionContextKeys.SelectedCategoryName, StringComparison.Ordinal)
            ? SettingsOptionsDependencyScope.Context
            : SettingsOptionsDependencyScope.Sibling;

    private static string GetJsonPropertyName(PropertyInfo property) {
        var jsonPropertyAttr = property.GetCustomAttribute<JsonPropertyAttribute>();
        return jsonPropertyAttr?.PropertyName ?? property.Name;
    }
}
