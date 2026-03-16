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
}
