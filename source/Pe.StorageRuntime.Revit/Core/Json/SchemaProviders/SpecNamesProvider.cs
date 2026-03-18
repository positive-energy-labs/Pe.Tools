using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public class SpecNamesProvider : IFieldOptionsSource {
    public FieldOptionsDescriptor Describe() => new(
        nameof(SpecNamesProvider),
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
        GetLabelToForgeMap()
            .Keys
            .Select(value => new FieldOptionItem(value, value, null))
            .ToList()
    );

    public static Dictionary<string, ForgeTypeId> GetLabelToForgeMap() {
        var labelMap = new Dictionary<string, ForgeTypeId>();

        foreach (var spec in SpecUtils.GetAllSpecs()) {
            var label = FormatSpecWithDiscipline(spec);
            _ = labelMap.TryAdd(label, spec);
        }

        return labelMap;
    }

    public static Dictionary<ForgeTypeId, string> GetForgeToLabelMap() =>
        GetLabelToForgeMap().ToDictionary(kvp => kvp.Value, kvp => kvp.Key);

    public static string GetLabelForForge(ForgeTypeId forge) =>
        GetForgeToLabelMap().TryGetValue(forge, out var label) ? label : forge.TypeId;

    private static string FormatSpecWithDiscipline(ForgeTypeId spec) {
        var label = spec.ToLabel();
        var discipline = GetParentheticDiscipline(spec);
        return $"{label}{discipline}";
    }

    private static string GetParentheticDiscipline(ForgeTypeId spec) {
        if (!UnitUtils.IsMeasurableSpec(spec))
            return string.Empty;
        var disciplineId = UnitUtils.GetDiscipline(spec);
        var disciplineLabel = LabelUtils.GetLabelForDiscipline(disciplineId);
        return !string.IsNullOrEmpty(disciplineLabel) ? $" ({disciplineLabel})" : string.Empty;
    }
}
