using Pe.Shared.HostContracts.SettingsStorage;
using NJsonSchema;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;

internal static class SchemaMetadataWriter {
    private static readonly StringComparer ExampleValueComparer = StringComparer.OrdinalIgnoreCase;

    public static void ApplyValueDomain(
        JsonSchema targetSchema,
        SettingsValueDomainDescriptor descriptor,
        IReadOnlyList<FieldOptionItem>? samples = null
    ) {
        if (targetSchema == null)
            throw new ArgumentNullException(nameof(targetSchema));
        if (descriptor == null)
            throw new ArgumentNullException(nameof(descriptor));

        targetSchema.ExtensionData ??= new Dictionary<string, object?>();
        targetSchema.ExtensionData["x-options"] = descriptor.ToOptionsPayload();

        if (samples == null || samples.Count == 0)
            return;

        var existingExamples = targetSchema.ExtensionData.TryGetValue("examples", out var existing) &&
                               existing is IEnumerable<string> enumerableExamples
            ? enumerableExamples
            : [];

        var orderedValues = CreateOrderedExampleList(existingExamples.Concat(samples.Select(sample => sample.Value)));
        targetSchema.ExtensionData["examples"] = orderedValues;
    }

    public static List<string> CreateOrderedExampleList(IEnumerable<string> values) =>
        values
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .Distinct(ExampleValueComparer)
            .OrderBy(value => value, ExampleValueComparer)
            .ThenBy(value => value, StringComparer.Ordinal)
            .ToList();
}
