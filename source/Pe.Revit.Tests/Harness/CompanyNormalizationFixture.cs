using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Shared.RevitData.Families;
using Pe.Revit.Parameters;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.Global.Services.Aps;
using Pe.Revit.DocumentData.Parameters;

namespace Pe.Revit.Tests;

/// <summary>Test-only parameter conversion after existing include/filter composition. Unsupported policy fails explicitly.</summary>
internal static class CompanyNormalizationFixture {
    public static Pe.Revit.FamilyFoundry.Apply.FamilyProfileConversion ConvertProfileParameters(JObject profile, Document document,
        IReadOnlyList<ParametersApi.Parameters.ParametersResult> definitions) =>
        Pe.Revit.FamilyFoundry.Apply.FamilyProfileConverter.Convert(profile, definitions, document.GetUnits());

    public static JObject ApplyNativeProfileOverride(string source, JObject settings) {
        var path = RevitFamilyFixtureHarness.GetProfileFixturePath(Path.Combine("native-overrides", "grinder-pump-basin-sound-level.json"));
        var profileOverride = JObject.Parse(File.ReadAllText(path));
        if (source.Replace('\\', '/') != profileOverride.Value<string>("source")) return settings;
        var copy = (JObject)settings.DeepClone();
        var parameter = profileOverride.Value<string>("parameter")!;
        var assignment = copy["SetKnownParams"]!["GlobalAssignments"]!.Single(item => item.Value<string>("Parameter") == parameter);
        if (assignment.Value<string>("Value") != profileOverride.Value<string>("sourceValue"))
            throw new InvalidOperationException($"The Grinder native override no longer matches its frozen source assignment: {parameter}.");
        assignment["Value"] = profileOverride["value"]!.DeepClone();
        return copy;
    }

    public static FamilyPatch Convert(MapParamsSettings mappings, IEnumerable<string> selectedSharedNames,
        SetKnownParamsSettings? assignments = null, bool fillBlanksFromSources = false,
        IReadOnlyDictionary<string, ForgeTypeId>? specs = null, Units? legacyUnits = null) {
        var parameters = new JObject();
        var selected = selectedSharedNames.ToHashSet(StringComparer.Ordinal);
        foreach (var name in selected) parameters[name] = new JObject { ["shared"] = true };
        if (mappings.Enabled) {
            foreach (var mapping in mappings.GetMappingsByNewName().Values.Where(m => selected.Contains(m.NewName))) {
                if (mapping.OnlyAddIfSourceExists) throw new InvalidOperationException($"Conditional source-only rule needs per-family conversion: {mapping.NewName}");
                var parameter = (JObject)parameters[mapping.NewName]!;
                parameter["wasNamed"] = new JArray(mapping.CurrNames);
                parameter["mappingStrategy"] = mapping.MappingStrategy;
                parameter["fillBlanksFromSources"] = fillBlanksFromSources;
                if (mapping.SourceValuesTreatedAsMissing.Count > 0)
                    parameter["sourceValuesTreatedAsMissing"] = new JArray(mapping.SourceValuesTreatedAsMissing);
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
                // A blank legacy profile cell meant "no value for this type".
                foreach (var (type, value) in cells.Where(cell => !string.IsNullOrWhiteSpace(cell.Value))) {
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

    public static (HashSet<string> Families, MapParamsSettings Mappings) OldTemplateHorsepowerOverride() {
        var path = RevitFamilyFixtureHarness.GetProfileFixturePath(Path.Combine("native-overrides", "old-template-magna3-horsepower.json"));
        var profile = JObject.Parse(File.ReadAllText(path));
        var families = profile["FilterFamilies"]!["IncludeNames"]!["Equaling"]!.Values<string>().ToHashSet(StringComparer.Ordinal);
        var overlay = profile["AddAndMapSharedParams"]!["MappingData"]!.ToObject<List<MappingData>>()!;
        return (families, new MapParamsSettings { MappingData = MechanicalMappings().MappingData.Concat(overlay).ToList() });
    }
}
