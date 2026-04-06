using Pe.Shared.RevitData.Parameters;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public class SpecNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(SpecNamesProvider),
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
        RevitTypeLabelCatalog.GetLabelToSpecMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelToForgeMap() =>
        RevitTypeLabelCatalog.GetLabelToSpecMap();

    public static Dictionary<ForgeTypeId, string> GetForgeToLabelMap() =>
        RevitTypeLabelCatalog.GetSpecToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitTypeLabelCatalog.GetLabelForSpec(forge);
}
