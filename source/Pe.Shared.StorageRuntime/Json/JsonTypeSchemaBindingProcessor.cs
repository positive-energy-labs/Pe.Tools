using NJsonSchema.Generation;

namespace Pe.Shared.StorageRuntime.Json;

public sealed class JsonTypeSchemaBindingProcessor(JsonSchemaBuildOptions options) : ISchemaProcessor {
    private readonly JsonSchemaBuildOptions _options =
        options ?? throw new ArgumentNullException(nameof(options));

    public void Process(SchemaProcessorContext context) =>
        JsonTypeSchemaBindingRegistry.Shared.ApplyPropertyBindings(context, this._options);
}
