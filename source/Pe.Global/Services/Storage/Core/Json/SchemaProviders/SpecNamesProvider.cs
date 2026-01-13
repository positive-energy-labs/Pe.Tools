using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

public class SpecNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() =>
        GetLabelToForgeMap().Keys;

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
        if (!UnitUtils.IsMeasurableSpec(spec)) return string.Empty;
        var disciplineId = UnitUtils.GetDiscipline(spec);
        var disciplineLabel = LabelUtils.GetLabelForDiscipline(disciplineId);
        return !string.IsNullOrEmpty(disciplineLabel) ? $" ({disciplineLabel})" : string.Empty;
    }
}