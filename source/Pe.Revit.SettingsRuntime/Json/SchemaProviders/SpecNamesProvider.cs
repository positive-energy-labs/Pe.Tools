using Pe.Revit.SettingsRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Capabilities;

namespace Pe.Revit.SettingsRuntime.Json.SchemaProviders;

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
        RevitLabelCatalog.GetLabelToSpecMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelToForgeMap() =>
        RevitLabelCatalog.GetLabelToSpecMap();

    public static Dictionary<ForgeTypeId, string> GetForgeToLabelMap() =>
        RevitLabelCatalog.GetSpecToLabelMap();

    public static string GetLabelForForge(ForgeTypeId forge) =>
        RevitLabelCatalog.GetLabelForSpec(forge);
}

