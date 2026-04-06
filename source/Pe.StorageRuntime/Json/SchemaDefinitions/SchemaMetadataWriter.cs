using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Json.SchemaDefinitions;

internal static class SchemaMetadataWriter {
    public static void ApplyRootData(
        JsonSchema targetSchema,
        IReadOnlyDictionary<string, SettingsSchemaDatasetBinding> datasets
    ) {
        if (targetSchema == null)
            throw new ArgumentNullException(nameof(targetSchema));
        if (datasets == null || datasets.Count == 0)
            return;

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        targetSchema.ExtensionData["x-data"] = CreateRootDataPayload(datasets);
    }

    public static void ApplyFieldOptions(
        JsonSchema targetSchema,
        FieldOptionsDescriptor descriptor,
        IReadOnlyList<FieldOptionItem>? samples = null
    ) {
        if (targetSchema == null)
            throw new ArgumentNullException(nameof(targetSchema));
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        targetSchema.ExtensionData["x-options"] = CreateOptionsPayload(
            descriptor.Key,
            descriptor.Resolver,
            descriptor.Mode,
            descriptor.AllowsCustomValue,
            descriptor.DependsOn
        );
        targetSchema.ExtensionData["x-runtime-capabilities"] = CreateRuntimeCapabilitiesPayload(
            descriptor.RequiredRuntimeMode
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

    public static void ApplyDatasetOptions(
        JsonSchema targetSchema,
        SettingsSchemaDatasetOptionsBinding binding
    ) {
        if (targetSchema == null)
            throw new ArgumentNullException(nameof(targetSchema));
        if (binding == null)
            throw new ArgumentNullException(nameof(binding));

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        var payload = CreateOptionsPayload(
            binding.Key,
            SettingsOptionsResolverKind.Dataset,
            binding.Mode,
            binding.AllowsCustomValue,
            binding.DependsOn
        );
        payload["datasetRef"] = binding.DatasetRef;
        payload["projection"] = binding.Projection;
        targetSchema.ExtensionData["x-options"] = payload;
    }

    private static JObject CreateOptionsPayload(
        string key,
        SettingsOptionsResolverKind resolver,
        SettingsOptionsMode mode,
        bool allowsCustomValue,
        IReadOnlyList<FieldOptionsDependency> dependsOn
    ) {
        var serializer = JsonSerializer.CreateDefault(new JsonSerializerSettings {
            Converters = [new StringEnumConverter()]
        });

        return new JObject {
            ["key"] = key,
            ["resolver"] = JToken.FromObject(resolver, serializer),
            ["mode"] = JToken.FromObject(mode, serializer),
            ["allowsCustomValue"] = allowsCustomValue,
            ["dependsOn"] = JArray.FromObject(
                dependsOn.Select(dependency => new SettingsOptionsDependency(
                    dependency.Key,
                    dependency.Scope
                )),
                serializer
            )
        };
    }

    private static JObject CreateRuntimeCapabilitiesPayload(SettingsRuntimeMode runtimeMode) =>
        JObject.FromObject(runtimeMode.ToMetadata());

    private static JObject CreateRootDataPayload(
        IReadOnlyDictionary<string, SettingsSchemaDatasetBinding> datasets
    ) {
        var datasetPayload = new JObject();
        foreach (var dataset in datasets.Values.OrderBy(item => item.Id, StringComparer.OrdinalIgnoreCase)) {
            datasetPayload[dataset.Id] = new JObject {
                ["provider"] = dataset.Provider,
                ["load"] = dataset.LoadMode.ToString(),
                ["staleOn"] = new JArray(dataset.StaleOn),
                ["supportedProjections"] = new JArray(dataset.SupportedProjections)
            };
        }

        return new JObject { ["datasets"] = datasetPayload };
    }
}
