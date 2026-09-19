using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Test-only patches from the company mechanical mapping fragment. Unsupported policy fails explicitly.</summary>
internal static class CompanyNormalizationFixture {
    public static FamilyPatch Convert(MapParamsSettings mappings, IEnumerable<string> selectedSharedNames) {
        var parameters = new JObject();
        var selected = selectedSharedNames.ToHashSet(StringComparer.Ordinal);
        foreach (var name in selected) parameters[name] = new JObject { ["shared"] = true };
        if (mappings.Enabled) {
            foreach (var mapping in mappings.GetMappingsByNewName().Values.Where(m => selected.Contains(m.NewName))) {
                if (mapping.OnlyAddIfSourceExists) throw new InvalidOperationException($"Conditional source-only rule needs per-family conversion: {mapping.NewName}");
                var parameter = (JObject)parameters[mapping.NewName]!;
                parameter["wasNamed"] = new JArray(mapping.CurrNames);
                parameter["mappingStrategy"] = mapping.MappingStrategy;
                parameter["fillBlanksFromSources"] = false;
                if (mapping.SourceValuesTreatedAsMissing.Count > 0)
                    parameter["sourceValuesTreatedAsMissing"] = new JArray(mapping.SourceValuesTreatedAsMissing);
            }
        }
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters, ["types"] = new JObject() } };
    }

    public static MapParamsSettings MechanicalMappings() {
        var path = RevitFamilyFixtureHarness.GetProfileFixturePath("mech-equip-mapping-data.json");
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
