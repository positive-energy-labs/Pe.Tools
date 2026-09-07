using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Test-only parameter conversion after existing include/filter composition. Unsupported policy fails explicitly.</summary>
internal static class CompanyNormalizationFixture {
    public static FamilyPatch Convert(MapParamsSettings mappings, IEnumerable<string> selectedSharedNames,
        SetKnownParamsSettings? assignments = null, bool fillBlanksFromSources = false) {
        var parameters = new JObject();
        var selected = selectedSharedNames.ToHashSet(StringComparer.Ordinal);
        foreach (var name in selected) parameters[name] = new JObject { ["shared"] = true };
        if (mappings.Enabled) {
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var mapping in mappings.MappingData.Where(m => selected.Contains(m.NewName))) {
                if (!seen.Add(mapping.NewName)) throw new InvalidOperationException($"Duplicate mapping target: {mapping.NewName}");
                if (mapping.OnlyAddIfSourceExists) throw new InvalidOperationException($"Conditional source-only rule needs per-family conversion: {mapping.NewName}");
                var parameter = (JObject)parameters[mapping.NewName]!;
                parameter["wasNamed"] = new JArray(mapping.CurrNames);
                parameter["mappingStrategy"] = mapping.MappingStrategy;
                parameter["fillBlanksFromSources"] = fillBlanksFromSources;
            }
        }
        var types = new JObject();
        if (assignments?.Enabled == true) {
            if (!assignments.OverrideExistingValues) throw new InvalidOperationException("Conditional assignment needs per-family conversion; explicit JSON always wins.");
            foreach (var assignment in assignments.GetGlobalAssignmentsByParameter().Values) {
                if (!parameters.ContainsKey(assignment.Parameter)) parameters[assignment.Parameter] = new JObject();
                if (assignment.Kind == ParamAssignmentKind.Value) CheckUnits(assignment.Value);
                parameters[assignment.Parameter]![assignment.Kind == ParamAssignmentKind.Formula ? "formula" : "value"] = assignment.Value;
            }
            foreach (var (parameter, cells) in assignments.GetPerTypeAssignmentsByParameter())
                foreach (var (type, value) in cells) {
                    CheckUnits(value);
                    types[type] ??= new JObject();
                    types[type]![parameter] = value;
                }
        }
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters, ["types"] = types } };
    }

    private static void CheckUnits(string value) {
        if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _))
            throw new InvalidOperationException($"Unitless legacy numeric assignment needs datatype/unit review: {value}");
    }

    public static MapParamsSettings MechanicalMappings() {
        var path = Path.Combine(AppContext.BaseDirectory, "Fixtures", "Profiles", "company-20260906", "Global", "fragments", "_mapping-data", "mech-equip-mapping-data.json");
        return new MapParamsSettings { MappingData = JObject.Parse(File.ReadAllText(path))["Items"]!.ToObject<List<MappingData>>()! };
    }
}
