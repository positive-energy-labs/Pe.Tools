using Pe.Shared.RevitData.Parameters;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Json.FieldOptions;

namespace Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;

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
        RevitTypeLabelCatalog.GetLabelToPropertyGroupMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelForgeMap() =>
        RevitTypeLabelCatalog.GetLabelToPropertyGroupMap();

    public static Dictionary<ForgeTypeId, string> GetForgeLabelMap() =>
        RevitTypeLabelCatalog.GetPropertyGroupToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitTypeLabelCatalog.GetLabelForPropertyGroup(forge);
}
