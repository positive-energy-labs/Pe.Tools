using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Shared.RevitData.Families;
using Pe.Revit.Parameters;

namespace Pe.Revit.Tests;

/// <summary>Test-only parameter conversion after existing include/filter composition. Unsupported policy fails explicitly.</summary>
internal static class CompanyNormalizationFixture {
    public static FamilyPatch Convert(MapParamsSettings mappings, IEnumerable<string> selectedSharedNames,
        SetKnownParamsSettings? assignments = null, bool fillBlanksFromSources = false,
        IReadOnlyDictionary<string, ForgeTypeId>? specs = null, Units? legacyUnits = null) {
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
            if (!assignments.OverrideExistingValues && (assignments.GlobalAssignments.Count != 0 || assignments.PerTypeAssignmentsTable.Count != 0))
                throw new InvalidOperationException("Conditional assignment needs per-family conversion; explicit JSON always wins.");
            foreach (var assignment in assignments.GetGlobalAssignmentsByParameter().Values) {
                if (!parameters.ContainsKey(assignment.Parameter)) parameters[assignment.Parameter] = new JObject();
                parameters[assignment.Parameter]![assignment.Kind == ParamAssignmentKind.Formula ? "formula" : "value"] =
                    assignment.Kind == ParamAssignmentKind.Formula ? assignment.Value : Literal(assignment.Parameter, assignment.Value, specs, legacyUnits);
            }
            foreach (var (parameter, cells) in assignments.GetPerTypeAssignmentsByParameter())
                foreach (var (type, value) in cells) {
                    types[type] ??= new JObject();
                    types[type]![parameter] = Literal(parameter, value, specs, legacyUnits);
                }
        }
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters, ["types"] = types } };
    }

    private static string Literal(string parameter, string value, IReadOnlyDictionary<string, ForgeTypeId>? specs, Units? legacyUnits) {
        if (!double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _)) return value;
        if (specs is null || !specs.TryGetValue(parameter, out var spec))
            throw new InvalidOperationException($"Unitless legacy assignment needs an exact source datatype: {parameter}={value}");
        if (spec == SpecTypeId.Number || spec == SpecTypeId.Int.Integer || !UnitUtils.IsMeasurableSpec(spec)) return value;
        if (legacyUnits is null || !UnitFormatUtils.TryParse(legacyUnits, spec, value, out var internalValue))
            throw new InvalidOperationException($"Unitless legacy assignment needs its source document units: {parameter}={value}");
        var formatted = ParameterPortableFormat.ForSpec(spec)(internalValue);
        if (!UnitFormatUtils.TryParse(legacyUnits, spec, formatted, out var reread) || Math.Abs(reread - internalValue) > Math.Max(1, Math.Abs(internalValue)) * 1e-12 ||
            FamilyValueUnits.Validate(new JObject { ["parameters"] = new JObject { [parameter] = new JObject { ["value"] = formatted } } }, _ => true).Count != 0)
            throw new InvalidOperationException($"Legacy unit formatting cannot preserve {parameter}={value}; explicit authoring is required.");
        return formatted;
    }

    public static MapParamsSettings MechanicalMappings() {
        var path = RevitFamilyFixtureHarness.GetProfileFixturePath(Path.Combine("company-20260906", "Global", "fragments", "_mapping-data", "mech-equip-mapping-data.json"));
        return new MapParamsSettings { MappingData = JObject.Parse(File.ReadAllText(path))["Items"]!.ToObject<List<MappingData>>()! };
    }
}
