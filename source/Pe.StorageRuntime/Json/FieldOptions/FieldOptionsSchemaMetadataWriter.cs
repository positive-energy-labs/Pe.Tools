using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.StorageRuntime.Capabilities;

namespace Pe.StorageRuntime.Json.FieldOptions;

public static class FieldOptionsSchemaMetadataWriter {
    public static void Apply(
        JsonSchema targetSchema,
        FieldOptionsDescriptor descriptor,
        IReadOnlyList<FieldOptionItem>? samples = null
    ) {
        if (targetSchema == null)
            throw new ArgumentNullException(nameof(targetSchema));
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        targetSchema.ExtensionData["x-options"] = CreateFieldOptionsSource(descriptor);
        targetSchema.ExtensionData["x-runtime-capabilities"] = CreateRuntimeCapabilitiesPayload(
            descriptor.RequiredCapabilities
        );

        if (samples == null || samples.Count == 0)
            return;

        var existingExamples = targetSchema.ExtensionData.TryGetValue("examples", out var existing) &&
                               existing is IEnumerable<string> enumerableExamples
            ? enumerableExamples
            : [];

        targetSchema.ExtensionData["examples"] = existingExamples
            .Concat(samples.Select(sample => sample.Value))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static JObject CreateFieldOptionsSource(FieldOptionsDescriptor descriptor) {
        var serializer = JsonSerializer.CreateDefault(new JsonSerializerSettings {
            Converters = [new StringEnumConverter()]
        });

        return new JObject {
            ["key"] = descriptor.Key,
            ["resolver"] = JToken.FromObject(descriptor.Resolver, serializer),
            ["dataset"] = descriptor.Dataset == null
                ? JValue.CreateNull()
                : JToken.FromObject(descriptor.Dataset.Value, serializer),
            ["mode"] = JToken.FromObject(descriptor.Mode, serializer),
            ["allowsCustomValue"] = descriptor.AllowsCustomValue,
            ["dependsOn"] = JArray.FromObject(
                descriptor.DependsOn.Select(dependency => new SettingsOptionsDependency(
                    dependency.Key,
                    dependency.Scope
                )),
                serializer
            )
        };
    }

    private static JObject CreateRuntimeCapabilitiesPayload(
        SettingsRuntimeCapabilities capabilities
    ) => JObject.FromObject(capabilities.ToMetadata());
}
