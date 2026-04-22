using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProviders;

public class PropertyGroupNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(PropertyGroupNamesProvider),
        SettingsOptionsResolverKind.Remote,
        SettingsOptionsMode.Suggestion,
        true,
        [],
        SettingsRuntimeMode.HostOnly
    );

    public ValueTask<IReadOnlyList<FieldOptionItem>> GetOptionsAsync(
        FieldOptionsExecutionContext context,
        CancellationToken cancellationToken = default
    ) => new(
        RevitLabelCatalog.GetLabelToPropertyGroupMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelForgeMap() =>
        RevitLabelCatalog.GetLabelToPropertyGroupMap();

    public static Dictionary<ForgeTypeId, string> GetForgeLabelMap() =>
        RevitLabelCatalog.GetPropertyGroupToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitLabelCatalog.GetLabelForPropertyGroup(forge);
}

