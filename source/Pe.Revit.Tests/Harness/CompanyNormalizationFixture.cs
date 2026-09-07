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
    public static FamilyPatch ConvertProfileParameters(JObject profile, Document document,
        IReadOnlyList<ParametersApi.Parameters.ParametersResult> definitions) {
        var filter = profile["FilterApsParams"];
        var older = profile["SharedParameterSelection"];
        var selected = definitions.Where(d => !d.IsArchived && Matches(d.Name!, filter?["IncludeNames"] ?? older?["Include"], true) &&
            !Matches(d.Name!, filter?["ExcludeNames"] ?? older?["Exclude"], false)).Select(d => d.Name!).ToList();
        var mappings = profile["AddAndMapSharedParams"]?.ToObject<MapParamsSettings>() ??
            new MapParamsSettings { Enabled = profile["MappingData"] is not null, MappingData = profile["MappingData"]?.ToObject<List<MappingData>>() ?? [] };
        var conditional = mappings.MappingData.Where(m => m.OnlyAddIfSourceExists).ToList();
        foreach (var mapping in conditional) {
            if (document.FamilyManager.get_Parameter(mapping.NewName) is null && !mapping.CurrNames.Any(n => document.FamilyManager.get_Parameter(n) is not null))
                selected.Remove(mapping.NewName);
        }
        // The existing converter can now consume the per-family decision without an unresolved conditional rule.
        var resolvedMappings = JObject.FromObject(mappings);
        foreach (var mapping in resolvedMappings["MappingData"]!) mapping["OnlyAddIfSourceExists"] = false;
        var specs = definitions.ToDictionary(d => d.Name!, d => d.DownloadOptions.GetSpecTypeId(), StringComparer.Ordinal);
        var locals = new JObject();
        if (profile["AddFamilyParams"] is JObject add && add.Value<bool?>("Enabled") != false) {
            var labels = RevitLabelCatalog.GetLabelToSpecMap();
            foreach (var local in add["Parameters"] ?? new JArray()) {
                var name = (string)local["Name"]!;
                var label = (string?)local["DataType"] ?? "Text (Common)";
                var spec = labels.TryGetValue(label, out var known) ? known : throw new InvalidOperationException($"Unknown legacy datatype {label}: {name}");
                specs[name] = spec;
                var dataType = Enum.GetValues(typeof(DataType)).Cast<DataType>().First(t => SetParamMetadata.Spec(t) == spec);
                locals[name] = new JObject { ["dataType"] = dataType.ToString(), ["isInstance"] = local.Value<bool?>("IsInstance") ?? true,
                    ["propertiesGroup"] = SetParamMetadata.Group((string?)local["PropertiesGroup"] ?? "").TypeId };
                if (local["Tooltip"] is { Type: JTokenType.String } tooltip) locals[name]!["tooltip"] = tooltip.DeepClone();
            }
        }
        foreach (FamilyParameter parameter in document.FamilyManager.Parameters) specs.TryAdd(parameter.Definition.Name, parameter.Definition.GetDataType());
        var assignments = profile["SetKnownParams"]?.ToObject<SetKnownParamsSettings>();
        if (older is not null) {
            if (profile["FamilyParameters"]?.HasValues == true || profile["PerTypeAssignmentsTable"]?.HasValues == true)
                throw new InvalidOperationException("Unmodeled older local/type assignments must be converted explicitly.");
            assignments = new SetKnownParamsSettings { GlobalAssignments = (profile["SharedParameters"] ?? new JArray())
                .Select(p => new GlobalParamAssignment { Parameter = (string)p["Name"]!, Kind = ParamAssignmentKind.Value, Value = (string)p["Value"]! }).ToList() };
        }
        var patch = Convert(resolvedMappings.ToObject<MapParamsSettings>()!, selected,
            assignments, specs: specs, legacyUnits: document.GetUnits());
        var parameters = (JObject)patch.Patch["parameters"]!;
        foreach (var local in locals.Properties()) {
            if (parameters[local.Name] is JObject assigned) ((JObject)local.Value).Merge(assigned);
            parameters[local.Name] = local.Value;
        }
        return patch;

        static bool Matches(string name, JToken? rules, bool empty) {
            var equal = (rules?["Equaling"] ?? rules?["Names"])?.Values<string>().ToList() ?? [];
            var starts = rules?["StartingWith"]?.Values<string>().ToList() ?? [];
            var contains = rules?["Containing"]?.Values<string>().ToList() ?? [];
            return equal.Count + starts.Count + contains.Count == 0 ? empty : equal.Contains(name) ||
                starts.Any(p => name.StartsWith(p!, StringComparison.Ordinal)) || contains.Any(p => name.Contains(p!, StringComparison.Ordinal));
        }
    }

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
