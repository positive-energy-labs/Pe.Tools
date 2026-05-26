using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NJsonSchema;
using NJsonSchema.Generation;
using Pe.Revit.SettingsRuntime.Json.SchemaProcessors;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;

public sealed class SchemaDefinitionProcessor(JsonSchemaBuildOptions options) : ISchemaProcessor {
    private readonly JsonSchemaBuildOptions _options =
        options ?? throw new ArgumentNullException(nameof(options));

    public void Process(SchemaProcessorContext context) {
        if (!SettingsSchemaDefinitionRegistry.Shared.TryGet(context.ContextualType.Type, out var definition))
            return;

        var actualSchema = context.Schema.HasReference ? context.Schema.Reference : context.Schema;
        if (actualSchema == null)
            return;

        if (context.ContextualType.Type == definition.SettingsType && definition.Datasets.Count != 0)
            SchemaMetadataWriter.ApplyRootData(actualSchema, definition.Datasets);

        foreach (var binding in definition.Bindings.Values) {
            if (!actualSchema.Properties.TryGetValue(binding.JsonPropertyName, out var propertySchema))
                continue;

            var targetSchema = propertySchema.Item ?? propertySchema;

            if (binding.DisallowNull)
                DisallowExplicitNull(propertySchema);

            if (!string.IsNullOrWhiteSpace(binding.Description))
                propertySchema.Description = binding.Description;

            if (!string.IsNullOrWhiteSpace(binding.DisplayName)) {
                propertySchema.ExtensionData ??= new Dictionary<string, object?>();
                propertySchema.ExtensionData["x-display-name"] = binding.DisplayName;
            }

            if (binding.StaticExamples.Count != 0) {
                targetSchema.ExtensionData ??= new Dictionary<string, object?>();
                targetSchema.ExtensionData["examples"] =
                    SchemaMetadataWriter.CreateOrderedExampleList(binding.StaticExamples);
            }

            if (!string.IsNullOrWhiteSpace(binding.IncludableFragmentRoot))
                SchemaIncludesProcessor.ApplyToCollectionProperty(propertySchema, binding.IncludableFragmentRoot);

            if (binding.Ui != null) {
                var resolvedUi = ResolveUiMetadata(binding, this._options);
                if (resolvedUi != null) {
                    propertySchema.ExtensionData ??= new Dictionary<string, object?>();
                    propertySchema.ExtensionData["x-ui"] = CreateUiPayload(resolvedUi);
                }
            }

            if (binding.DatasetOptions != null) {
                ValidateDatasetOptions(definition, binding);
                SchemaMetadataWriter.ApplyDatasetOptions(targetSchema, binding.DatasetOptions);
                continue;
            }

            if (binding.ValueDomain == null)
                continue;

            var descriptor = binding.ValueDomain;
            IReadOnlyList<ValueDomainOptionItem>? samples = null;
            if (this._options.ResolveValueDomainSamples &&
                this._options.RuntimeMode.Supports(descriptor.RequiredRuntimeMode)) {
                try {
                    if (this._options.TryGetCachedValueDomainSamples(descriptor.Key, null, out var cachedSamples)) {
                        samples = cachedSamples;
                    } else {
                        if (!SettingsValueDomainRegistry.Shared.TryCreate(descriptor.Key, out var domain))
                            throw new InvalidOperationException("Value domain is not registered.");

                        samples = domain
                            .GetOptionsAsync(this._options.CreateValueDomainExecutionContext())
                            .AsTask()
                            .GetAwaiter()
                            .GetResult();
                        samples = this._options.CacheValueDomainSamples(descriptor.Key, null, samples);
                    }
                } catch {
                }
            }

            SchemaMetadataWriter.ApplyValueDomain(targetSchema, descriptor, samples);
        }

    }

    private static void DisallowExplicitNull(JsonSchema schema) {
        schema.Type &= ~JsonObjectType.Null;

        foreach (var branch in schema.OneOf.Where(branch => branch.Type == JsonObjectType.Null).ToList())
            _ = schema.OneOf.Remove(branch);
    }

    private static void ValidateDatasetOptions(
        SettingsSchemaDefinitionDescriptor definition,
        SettingsSchemaPropertyBinding binding
    ) {
        var datasetOptions = binding.DatasetOptions
                             ?? throw new InvalidOperationException("Dataset options binding is required.");
        if (!TryResolveDatasetBinding(definition, datasetOptions.DatasetRef, out var datasetBinding)) {
            throw new InvalidOperationException(
                $"Property '{binding.JsonPropertyName}' references unknown dataset '{datasetOptions.DatasetRef}'."
            );
        }

        if (!datasetBinding.SupportedProjections.Contains(datasetOptions.Projection,
                StringComparer.OrdinalIgnoreCase)) {
            throw new InvalidOperationException(
                $"Property '{binding.JsonPropertyName}' references unsupported projection '{datasetOptions.Projection}' on dataset '{datasetOptions.DatasetRef}'."
            );
        }

        if (string.IsNullOrWhiteSpace(datasetOptions.Key)) {
            throw new InvalidOperationException(
                $"Property '{binding.JsonPropertyName}' dataset options must define a key."
            );
        }
    }

    private static bool TryResolveDatasetBinding(
        SettingsSchemaDefinitionDescriptor definition,
        string datasetRef,
        out SettingsSchemaDatasetBinding datasetBinding
    ) {
        if (definition.Datasets.TryGetValue(datasetRef, out datasetBinding!))
            return true;

        return SettingsSchemaDefinitionRegistry.Shared.TryResolveDatasetBinding(datasetRef, out datasetBinding);
    }

    private static SchemaUiMetadata? ResolveUiMetadata(
        SettingsSchemaPropertyBinding binding,
        JsonSchemaBuildOptions options
    ) {
        if (binding.Ui == null)
            return null;

        if (binding.UiDynamicColumnOrderSource == null)
            return binding.Ui;

        var resolvedValues = TryResolveDynamicColumnOrderValues(binding.UiDynamicColumnOrderSource, options);
        var behavior = binding.Ui.Behavior;
        var dynamicColumnOrder = behavior?.DynamicColumnOrder;
        if (behavior == null || dynamicColumnOrder == null)
            return binding.Ui;

        var mergedValues = resolvedValues.Count == 0
            ? dynamicColumnOrder.Values
            : resolvedValues;

        return binding.Ui with {
            Behavior = behavior with { DynamicColumnOrder = dynamicColumnOrder with { Values = mergedValues.ToList() } }
        };
    }

    private static IReadOnlyList<string> TryResolveDynamicColumnOrderValues(
        ISchemaUiDynamicColumnOrderSource source,
        JsonSchemaBuildOptions options
    ) {
        if (!options.RuntimeMode.Supports(source.RequiredRuntimeMode))
            return [];

        try {
            return source
                .GetValuesAsync(options.CreateValueDomainExecutionContext())
                .AsTask()
                .GetAwaiter()
                .GetResult();
        } catch {
            return [];
        }
    }

    private static JObject CreateUiPayload(SchemaUiMetadata metadata) {
        var serializer = JsonSerializer.CreateDefault(new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = new CamelCasePropertyNamesContractResolver()
        });
        return JObject.FromObject(metadata, serializer);
    }
}

