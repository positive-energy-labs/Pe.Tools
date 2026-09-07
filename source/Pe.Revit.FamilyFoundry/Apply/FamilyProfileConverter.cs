using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.RevitData.Families;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Parameters;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>Export selected company definitions and source rules as portable native patch intent, without resolving against one family.</summary>
public static class FamilyProfileConverter {
    /// <summary>Convert composed legacy settings to native intent. Refuses any active operation not yet represented; never rewrites source files.</summary>
    public static FamilyPatch Convert(JObject composed, IEnumerable<ParametersApi.Parameters.ParametersResult> definitions, Units sourceUnits) {
        var supported = new HashSet<string>(StringComparer.Ordinal) { "$schema", "ExecutionOptions", "FilterFamilies", "FilterApsParams",
            "AddAndMapSharedParams", "AddFamilyParams", "SetKnownParams", "CleanFamilyDocument", "SortParams", "DeleteParams",
            "SharedParameterSelection", "MappingData", "SharedParameters", "FamilyParameters", "PerTypeAssignmentsTable", "AddRoomDingler" };
        foreach (var field in composed.Properties().Where(p => !supported.Contains(p.Name)))
            if (field.Value is not JObject operation || operation.Value<bool?>("Enabled") != false)
                throw new InvalidOperationException($"Profile operation '{field.Name}' requires native conversion; it cannot be omitted from an exported standard.");
        if (composed["ExecutionOptions"] is JObject execution && execution.HasValues)
            throw new InvalidOperationException("Profile ExecutionOptions require an explicit processor invocation; export cannot discard them.");
        var familyFilter = composed["FilterFamilies"];
        foreach (var side in new[] { "IncludeNames", "ExcludeNames" })
            if (familyFilter?[side] is JObject names && names.Properties().Any(p => p.Name != "Equaling" && p.Value.HasValues) ||
                side == "ExcludeNames" && familyFilter?[side]?["Equaling"]?.HasValues == true)
                throw new InvalidOperationException("Family name pattern/exclusion selection needs a native selector before export.");
        if (!string.IsNullOrEmpty((string?)familyFilter?["IncludeByCondition"]?["FieldName"]))
            throw new InvalidOperationException("Family field conditions need a native selector before export.");
        var older = composed["SharedParameterSelection"];
        var filter = composed["FilterApsParams"];
        var include = filter?["IncludeNames"] ?? older?["Include"];
        var selected = definitions.Where(d => (!d.IsArchived || (include?["Equaling"] ?? include?["Names"])?.Values<string>().Contains(d.Name) == true) && Matches(d.Name!, include, true) &&
            !Matches(d.Name!, filter?["ExcludeNames"] ?? older?["Exclude"], false)).ToList();
        var mappings = composed["AddAndMapSharedParams"]?.ToObject<MapParamsSettings>() ?? new MapParamsSettings {
            Enabled = composed["MappingData"] is not null, MappingData = composed["MappingData"]?.ToObject<List<MappingData>>() ?? [] };
        var exported = ExportSharedMappings(mappings, selected, clean: composed["CleanFamilyDocument"]?.ToObject<CleanFamilyDocumentSettings>(),
            sort: composed["SortParams"]?.ToObject<SortParamsSettings>());
        var parameters = (JObject)exported.Patch["parameters"]!;
        var specs = selected.ToDictionary(d => d.Name!, d => d.DownloadOptions.GetSpecTypeId(), StringComparer.Ordinal);
        if (composed["AddFamilyParams"] is JObject add && add.Value<bool?>("Enabled") != false) {
            foreach (var local in add["Parameters"] ?? new JArray()) {
                var name = (string)local["Name"]!;
                var label = (string?)local["DataType"] ?? "Text (Common)";
                var spec = RevitLabelCatalog.ResolveSpec(label);
                specs[name] = spec;
                parameters[name] = new JObject {
                    ["dataType"] = Enum.GetValues(typeof(DataType)).Cast<DataType>().First(t => SetParamMetadata.Spec(t) == spec).ToString(),
                    ["isInstance"] = local.Value<bool?>("IsInstance") ?? true,
                    ["propertiesGroup"] = SetParamMetadata.Group((string?)local["PropertiesGroup"] ?? "").TypeId
                };
                if (local["Tooltip"] is { Type: JTokenType.String } tooltip) parameters[name]!["tooltip"] = tooltip.DeepClone();
            }
        }
        var assignments = composed["SetKnownParams"]?.ToObject<SetKnownParamsSettings>();
        if (older is not null) {
            if (composed["FamilyParameters"]?.HasValues == true || composed["PerTypeAssignmentsTable"]?.HasValues == true)
                throw new InvalidOperationException("Older local/type assignments require explicit conversion.");
            assignments = new SetKnownParamsSettings { GlobalAssignments = (composed["SharedParameters"] ?? new JArray())
                .Select(p => new GlobalParamAssignment { Parameter = (string)p["Name"]!, Kind = ParamAssignmentKind.Value, Value = (string)p["Value"]! }).ToList() };
        }
        if (assignments?.Enabled == true) {
            if (!assignments.OverrideExistingValues && (assignments.GlobalAssignments.Count > 0 || assignments.PerTypeAssignmentsTable.Count > 0))
                throw new InvalidOperationException("Blank-only legacy assignments require retained per-family rules; they cannot become unconditional values.");
            foreach (var assignment in assignments.GetGlobalAssignmentsByParameter().Values) {
                if (parameters[assignment.Parameter] is null) parameters[assignment.Parameter] =
                    exported.Run?.ParametersIfSourceExists?.TryGetValue(assignment.Parameter, out var conditional) == true
                        ? JObject.FromObject(conditional, JsonSerializer.Create(FamilyModelJson.Settings)) : new JObject();
                parameters[assignment.Parameter]![assignment.Kind == ParamAssignmentKind.Formula ? "formula" : "value"] =
                    assignment.Kind == ParamAssignmentKind.Formula ? assignment.Value : Literal(assignment.Parameter, assignment.Value, specs, sourceUnits);
            }
            var types = new JObject();
            foreach (var (parameter, cells) in assignments.GetPerTypeAssignmentsByParameter())
                foreach (var (type, value) in cells) {
                    types[type] ??= new JObject();
                    types[type]![parameter] = Literal(parameter, value, specs, sourceUnits);
                }
            if (types.HasValues) exported.Patch["types"] = types;
        }
        if (composed["DeleteParams"]?.ToObject<DeleteParamsSettings>() is { Enabled: true } deletes)
            foreach (var name in deletes.Names) parameters[name] = JValue.CreateNull();
        if (composed["AddRoomDingler"]?.ToObject<AddRoomDinglerSettings>() is { Enabled: true } room)
            exported.Patch["roomCalculationPoint"] = JObject.FromObject(new FamilyModelRoomCalculationPoint { Enabled = true, Offset = PortableLength.FromFeet(room.OffsetFeet) }, JsonSerializer.Create(FamilyModelJson.Settings));
        return new FamilyPatch { Patch = exported.Patch, Run = exported.Run, Select = new PatchSelect {
            Names = familyFilter?["IncludeNames"]?["Equaling"]?.ToObject<List<string>>(),
            Categories = familyFilter?["IncludeCategoriesEqualing"]?.ToObject<List<FamilyCategory>>(JsonSerializer.Create(FamilyModelJson.Settings)),
            PlacedOnly = familyFilter?.Value<bool?>("IncludeUnusedFamilies") == false ? true : null
        } };
    }

    private static bool Matches(string name, JToken? rules, bool empty) {
        var equal = (rules?["Equaling"] ?? rules?["Names"])?.Values<string>().ToList() ?? [];
        var starts = rules?["StartingWith"]?.Values<string>().ToList() ?? [];
        var contains = rules?["Containing"]?.Values<string>().ToList() ?? [];
        return equal.Count + starts.Count + contains.Count == 0 ? empty : equal.Contains(name) ||
            starts.Any(p => name.StartsWith(p!, StringComparison.Ordinal)) || contains.Any(p => name.Contains(p!, StringComparison.Ordinal));
    }

    private static string Literal(string name, string value, IReadOnlyDictionary<string, ForgeTypeId> specs, Units units) {
        if (!specs.TryGetValue(name, out var spec)) {
            if (double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out _))
                throw new InvalidOperationException($"Legacy literal needs a source datatype: {name}={value}");
            return value;
        }
        if (spec == SpecTypeId.Number || spec == SpecTypeId.Int.Integer || !UnitUtils.IsMeasurableSpec(spec)) return value;
        if (!UnitFormatUtils.TryParse(units, spec, value, out var raw)) throw new InvalidOperationException($"Legacy literal cannot resolve in source units: {name}={value}");
        return ParameterPortableFormat.ForSpec(spec)(raw);
    }

    public static FamilyPatch ExportSharedMappings(MapParamsSettings settings,
        IEnumerable<ParametersApi.Parameters.ParametersResult> selectedDefinitions, bool fillBlanksFromSources = false,
        CleanFamilyDocumentSettings? clean = null, SortParamsSettings? sort = null) {
        var definitions = selectedDefinitions.ToDictionary(d => d.Name!, StringComparer.Ordinal);
        var mappings = settings.Enabled ? settings.GetMappingsByNewName() : new Dictionary<string, MappingData>();
        var explicitParameters = new JObject();
        var conditional = new Dictionary<string, FamilyModelParameter>(StringComparer.Ordinal);
        foreach (var (name, definition) in definitions) {
            var options = definition.DownloadOptions;
            var parameter = new JObject {
                ["shared"] = true, ["sharedGuid"] = options.GetGuid().ToString(), ["sharedSpecId"] = options.GetSpecTypeId().TypeId,
                ["sharedVisible"] = options.Visible, ["sharedUserModifiable"] = !definition.ReadOnly,
                ["isInstance"] = options.IsInstance, ["propertiesGroup"] = options.GetGroupTypeId().TypeId
            };
            if (!string.IsNullOrEmpty(definition.Description)) parameter["tooltip"] = definition.Description;
            mappings.TryGetValue(name, out var mapping);
            if (mapping is not null) {
                parameter["wasNamed"] = new JArray(mapping.CurrNames);
                parameter["mappingStrategy"] = mapping.MappingStrategy;
                parameter["fillBlanksFromSources"] = fillBlanksFromSources;
            }
            if (mapping?.OnlyAddIfSourceExists == true)
                conditional[name] = parameter.ToObject<FamilyModelParameter>(JsonSerializer.Create(FamilyModelJson.Settings))!;
            else explicitParameters[name] = parameter;
        }
        return new FamilyPatch {
            Patch = new JObject { ["parameters"] = explicitParameters },
            Run = conditional.Count == 0 && clean is null && sort is null ? null : new PatchRun {
                ParametersIfSourceExists = conditional.Count == 0 ? null : conditional,
                Clean = clean is null ? null : JObject.FromObject(clean), Sort = sort is null ? null : JObject.FromObject(sort)
            }
        };
    }
}
