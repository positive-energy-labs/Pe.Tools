using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.PolyFill;
using System.Reflection;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public class PropertyGroupNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(PropertyGroupNamesProvider),
        SettingsOptionsResolverKind.Remote,
        null,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) => new ValueTask<IReadOnlyList<FieldOptionItem>>(
        GetLabelForgeMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelForgeMap() {
        var properties = typeof(GroupTypeId).GetProperties(BindingFlags.Public | BindingFlags.Static);
        var labelMap = new Dictionary<string, ForgeTypeId>();

        foreach (var property in properties) {
            if (property.PropertyType != typeof(ForgeTypeId))
                continue;
            var value = property.GetValue(null) as ForgeTypeId;
            if (value == null)
                continue;

            var label = value.ToLabel();
            _ = labelMap.TryAdd(label, value);
        }

        return labelMap;
    }

    public static Dictionary<ForgeTypeId, string> GetForgeLabelMap() =>
        GetLabelForgeMap().ToDictionary(kvp => kvp.Value, kvp => kvp.Key);

    public static string GetLabelForForge(ForgeTypeId forge) =>
        GetForgeLabelMap().TryGetValue(forge, out var label) ? label : forge.TypeId;
}
