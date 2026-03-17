using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NJsonSchema.Generation;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Json.SchemaDefinitions;

public sealed class SchemaDefinitionProcessor(JsonSchemaBuildOptions options) : ISchemaProcessor {
    private readonly JsonSchemaBuildOptions _options =
        options ?? throw new ArgumentNullException(nameof(options));

    public void Process(SchemaProcessorContext context) {
        if (!SettingsSchemaDefinitionRegistry.Shared.TryGet(context.ContextualType.Type, out var definition))
            return;

        var actualSchema = context.Schema.HasReference ? context.Schema.Reference : context.Schema;
        if (actualSchema == null)
            return;

        foreach (var binding in definition.Bindings.Values) {
            if (!actualSchema.Properties.TryGetValue(binding.JsonPropertyName, out var propertySchema))
                continue;

            var targetSchema = propertySchema.Item ?? propertySchema;

            if (!string.IsNullOrWhiteSpace(binding.Description))
                propertySchema.Description = binding.Description;

            if (!string.IsNullOrWhiteSpace(binding.DisplayName)) {
                propertySchema.ExtensionData ??= new Dictionary<string, object?>();
                propertySchema.ExtensionData["x-display-name"] = binding.DisplayName;
            }

            if (binding.StaticExamples.Count != 0) {
                targetSchema.ExtensionData ??= new Dictionary<string, object?>();
                targetSchema.ExtensionData["examples"] = binding.StaticExamples.ToList();
            }

            if (binding.Ui != null) {
                var resolvedUi = ResolveUiMetadata(binding, this._options);
                if (resolvedUi != null) {
                    propertySchema.ExtensionData ??= new Dictionary<string, object?>();
                    propertySchema.ExtensionData["x-ui"] = CreateUiPayload(resolvedUi);
                }
            }

            if (binding.FieldOptionsSource == null)
                continue;

            var descriptor = binding.FieldOptionsSource.Describe();
            IReadOnlyList<FieldOptionItem>? samples = null;
            if (this._options.ResolveFieldOptionSamples &&
                this._options.Capabilities.Supports(descriptor.RequiredCapabilities)) {
                try {
                    samples = binding.FieldOptionsSource
                        .GetOptionsAsync(this._options.CreateFieldOptionsExecutionContext())
                        .AsTask()
                        .GetAwaiter()
                        .GetResult();
                } catch {
                }
            }

            FieldOptionsSchemaMetadataWriter.Apply(targetSchema, descriptor, samples);
        }
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
        var dynamicColumnOrder = binding.Ui.Behavior?.DynamicColumnOrder;
        if (dynamicColumnOrder == null)
            return binding.Ui;

        var mergedValues = resolvedValues.Count == 0
            ? dynamicColumnOrder.Values
            : resolvedValues;

        return binding.Ui with {
            Behavior = binding.Ui.Behavior with {
                DynamicColumnOrder = dynamicColumnOrder with { Values = mergedValues.ToList() }
            }
        };
    }

    private static IReadOnlyList<string> TryResolveDynamicColumnOrderValues(
        ISchemaUiDynamicColumnOrderSource source,
        JsonSchemaBuildOptions options
    ) {
        if (!options.Capabilities.Supports(source.RequiredCapabilities))
            return [];

        try {
            return source
                .GetValuesAsync(options.CreateFieldOptionsExecutionContext())
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