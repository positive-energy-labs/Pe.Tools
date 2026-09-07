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
    private static readonly IReadOnlyDictionary<string, (ForgeTypeId Spec, ForgeTypeId Unit)> LegacyLiteralUnits =
        new Dictionary<string, (ForgeTypeId, ForgeTypeId)>(StringComparer.Ordinal) {
            ["PE_G___Weight"] = (SpecTypeId.Mass, UnitTypeId.PoundsMass),
            ["PE_M_Fan_ExternalStaticPressure"] = (SpecTypeId.HvacPressure, UnitTypeId.InchesOfWater60DegreesFahrenheit)
        };

    /// <summary>Convert composed legacy settings to native intent. Refuses any active operation not yet represented; never rewrites source files.</summary>
    public static FamilyProfileConversion Convert(JObject composed, IEnumerable<ParametersApi.Parameters.ParametersResult> definitions, Units sourceUnits) {
        var supported = new HashSet<string>(StringComparer.Ordinal) { "$schema", "ExecutionOptions", "FilterFamilies", "FilterApsParams",
            "AddAndMapSharedParams", "AddFamilyParams", "SetKnownParams", "CleanFamilyDocument", "SortParams", "DeleteParams",
            "SharedParameterSelection", "MappingData", "SharedParameters", "FamilyParameters", "PerTypeAssignmentsTable", "AddRoomDingler", "MakeRefPlaneAndDims" };
        foreach (var field in composed.Properties().Where(p => !supported.Contains(p.Name)))
            if (field.Value is not JObject operation || operation.Value<bool?>("Enabled") != false)
                throw new InvalidOperationException($"Profile operation '{field.Name}' requires native conversion; it cannot be omitted from an exported standard.");
        var executionOptions = ConvertExecutionOptions(composed["ExecutionOptions"]);
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
        ConvertReferencePlanes(composed["MakeRefPlaneAndDims"], exported.Patch);
        return new FamilyProfileConversion(new FamilyPatch { Patch = exported.Patch, Run = exported.Run, Select = new PatchSelect {
            Names = familyFilter?["IncludeNames"]?["Equaling"]?.ToObject<List<string>>(),
            Categories = familyFilter?["IncludeCategoriesEqualing"]?.ToObject<List<FamilyCategory>>(JsonSerializer.Create(FamilyModelJson.Settings)),
            PlacedOnly = familyFilter?.Value<bool?>("IncludeUnusedFamilies") == false ? true : null
        } }, executionOptions);
    }

    private static ExecutionOptions ConvertExecutionOptions(JToken? token) {
        if (token is null) return new ExecutionOptions();
        if (token is not JObject options) throw new InvalidOperationException("ExecutionOptions must be an object.");
        var supported = new[] { nameof(ExecutionOptions.SingleTransaction), nameof(ExecutionOptions.OptimizeTypeOperations),
            nameof(ExecutionOptions.EnableCollectors), nameof(ExecutionOptions.SuppressWarnings) };
        var unknown = options.Properties().Where(p => !supported.Contains(p.Name, StringComparer.Ordinal)).Select(p => p.Name).ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"ExecutionOptions fields are not supported: {string.Join(", ", unknown)}.");
        if (options.Properties().Any(p => p.Value.Type != JTokenType.Boolean))
            throw new InvalidOperationException("ExecutionOptions values must be booleans.");
        return options.ToObject<ExecutionOptions>() ?? throw new InvalidOperationException("ExecutionOptions could not be read.");
    }

    private static void ConvertReferencePlanes(JToken? token, JObject patch) {
        if (token is null) return;
        if (token is not JObject operation) throw new InvalidOperationException("MakeRefPlaneAndDims must be an object.");
        if (operation.Value<bool?>("Enabled") == false) return;
        var unknown = operation.Properties().Where(p => p.Name is not "Enabled" and not "MirrorSpecs" and not "OffsetSpecs").Select(p => p.Name).ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"MakeRefPlaneAndDims fields require native conversion: {string.Join(", ", unknown)}.");
        if (operation["MirrorSpecs"] is { } mirrorToken && mirrorToken is not JArray || operation["OffsetSpecs"] is { } offsetToken && offsetToken is not JArray)
            throw new InvalidOperationException("MakeRefPlaneAndDims MirrorSpecs and OffsetSpecs must be arrays.");
        var mirrors = operation["MirrorSpecs"] as JArray ?? [];
        var offsets = operation["OffsetSpecs"] as JArray ?? [];
        if (mirrors.Count + offsets.Count == 0)
            throw new InvalidOperationException("Active MakeRefPlaneAndDims has no mirror or offset specifications.");
        if (mirrors.Any(x => x is not JObject) || offsets.Any(x => x is not JObject))
            throw new InvalidOperationException("MakeRefPlaneAndDims specifications must be objects.");

        var planes = new JObject();
        var dimensions = new JObject();
        var serializer = JsonSerializer.Create(FamilyModelJson.Settings);
        var index = 0;
        foreach (var spec in mirrors.OfType<JObject>()) {
            RequireOnly(spec, "mirror", "Name", "CenterAnchor", "Parameter", "Strength");
            var name = Required(spec, "Name");
            var anchor = Required(spec, "CenterAnchor");
            var parameter = Required(spec, "Parameter");
            var normal = AxisFor(anchor);
            var (negative, positive) = normal switch {
                Axis.PlusX => ("Left", "Right"), Axis.PlusY => ("Back", "Front"), Axis.PlusZ => ("Bottom", "Top"),
                _ => throw new InvalidOperationException($"Unsupported mirror anchor axis: {anchor}.")
            };
            var left = $"{name} ({negative})";
            var right = $"{name} ({positive})";
            AddPlane(planes, left, new FamilyModelRefPlane { Normal = normal, At = PortableLength.FromFeet(-0.5), IsReference = Strength(spec) }, serializer);
            AddPlane(planes, right, new FamilyModelRefPlane { Normal = normal, At = PortableLength.FromFeet(0.5), IsReference = Strength(spec) }, serializer);
            dimensions[$"legacy-mirror-{index}-size"] = JObject.FromObject(new FamilyModelDim { Between = [left, right], Label = parameter }, serializer);
            dimensions[$"legacy-mirror-{index++}-eq"] = JObject.FromObject(new FamilyModelDim { Between = [left, anchor, right], Equality = true }, serializer);
        }
        foreach (var spec in offsets.OfType<JObject>()) {
            RequireOnly(spec, "offset", "Name", "AnchorName", "Direction", "Parameter", "Strength");
            var name = Required(spec, "Name");
            var anchor = Required(spec, "AnchorName");
            var direction = Required(spec, "Direction");
            if (direction is not "Positive" and not "Negative") throw new InvalidOperationException($"Unknown MakeRefPlaneAndDims direction '{direction}'.");
            AddPlane(planes, name, new FamilyModelRefPlane { Normal = AxisFor(anchor), At = PortableLength.FromFeet(direction == "Positive" ? 1 : -1), IsReference = Strength(spec) }, serializer);
            dimensions[$"legacy-offset-{index++}"] = JObject.FromObject(new FamilyModelDim { Between = [anchor, name], Label = Required(spec, "Parameter") }, serializer);
        }
        patch["refPlanes"] = planes;
        patch["dimensions"] = dimensions;
    }

    private static string Required(JObject value, string field) =>
        value.Value<string>(field) is { Length: > 0 } result ? result : throw new InvalidOperationException($"MakeRefPlaneAndDims requires {field}.");

    private static void RequireOnly(JObject value, string kind, params string[] fields) {
        var unknown = value.Properties().Where(p => !fields.Contains(p.Name, StringComparer.Ordinal)).Select(p => p.Name).ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"MakeRefPlaneAndDims {kind} fields require native conversion: {string.Join(", ", unknown)}.");
    }

    private static void AddPlane(JObject planes, string name, FamilyModelRefPlane plane, JsonSerializer serializer) {
        if (planes.ContainsKey(name)) throw new InvalidOperationException($"MakeRefPlaneAndDims generates duplicate plane '{name}'.");
        planes[name] = JObject.FromObject(plane, serializer);
    }

    private static Axis AxisFor(string anchor) => anchor switch {
        "Center (Left/Right)" or "Left" or "Right" => Axis.PlusX,
        "Center (Front/Back)" => Axis.PlusY,
        "Reference Plane" => Axis.PlusZ,
        _ => throw new InvalidOperationException($"MakeRefPlaneAndDims anchor '{anchor}' has no native axis mapping.")
    };

    private static RefStrength Strength(JObject spec) => spec.Value<string>("Strength") switch {
        null or "NotARef" => RefStrength.NotAReference,
        "WeakRef" => RefStrength.WeakReference,
        "StrongRef" => RefStrength.StrongReference,
        "CenterLR" => RefStrength.CenterLeftRight,
        "CenterFB" => RefStrength.CenterFrontBack,
        "CenterElev" => RefStrength.CenterElevation,
        var value when Enum.TryParse<RefStrength>(value, out var parsed) => parsed,
        var value => throw new InvalidOperationException($"Unknown MakeRefPlaneAndDims strength '{value}'.")
    };

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
        if (LegacyLiteralUnits.TryGetValue(name, out var legacy)) {
            var legacyUnits = new Units(UnitSystem.Imperial);
            legacyUnits.SetFormatOptions(legacy.Spec, new FormatOptions(legacy.Unit));
            if (!UnitFormatUtils.TryParse(legacyUnits, legacy.Spec, value, out var legacyRaw))
                throw new InvalidOperationException($"Legacy literal cannot resolve as {legacy.Spec.TypeId} in {legacy.Unit.TypeId}: {name}={value}");
            if (spec == SpecTypeId.Number)
                return UnitUtils.ConvertFromInternalUnits(legacyRaw, legacy.Unit).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            return ParameterPortableFormat.ForSpec(spec)(legacyRaw);
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

public sealed record FamilyProfileConversion(FamilyPatch Patch, ExecutionOptions Options);
