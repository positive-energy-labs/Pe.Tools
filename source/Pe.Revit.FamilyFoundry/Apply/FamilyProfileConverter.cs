using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.LookupTables;
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.RevitData.Families;
using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.Parameters;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.FamilyFoundry.Apply;

/// <summary>Export selected company definitions and source rules as portable native patch intent, without resolving against one family.</summary>
public static class FamilyProfileConverter {
    private static readonly IReadOnlyDictionary<string, string> LegacyParameterNames =
        new Dictionary<string, string>(StringComparer.Ordinal) {
            ["PE_G___Url"] = "PE_G___URL"
        };

    private static readonly IReadOnlyDictionary<string, (ForgeTypeId Spec, ForgeTypeId Unit)> LegacyLiteralUnits =
        new Dictionary<string, (ForgeTypeId, ForgeTypeId)>(StringComparer.Ordinal) {
            ["PE_G___Weight"] = (SpecTypeId.Mass, UnitTypeId.PoundsMass),
            ["PE_G___SoundLevel"] = (SpecTypeId.Number, UnitTypeId.General),
            ["PE_M_Fan_ExternalStaticPressure"] = (SpecTypeId.HvacPressure, UnitTypeId.InchesOfWater60DegreesFahrenheit)
        };

    /// <summary>Convert composed legacy settings to native intent. Refuses any active operation not yet represented; never rewrites source files.</summary>
    public static FamilyProfileConversion Convert(JObject composed, IEnumerable<ParametersApi.Parameters.ParametersResult> definitions, Units sourceUnits) {
        var supported = new HashSet<string>(StringComparer.Ordinal) { "$schema", "ExecutionOptions", "FilterFamilies", "FilterApsParams",
            "AddAndMapSharedParams", "AddFamilyParams", "SetKnownParams", "CleanFamilyDocument", "SortParams", "DeleteParams",
            "SharedParameterSelection", "MappingData", "SharedParameters", "FamilyParameters", "PerTypeAssignmentsTable", "AddRoomDingler", "MakeRefPlaneAndDims", "ParamDrivenSolids", "SetLookupTables", "MakeElectricalConnector" };
        foreach (var field in composed.Properties().Where(p => !supported.Contains(p.Name)))
            if (field.Value is not JObject operation || operation.Value<bool?>("Enabled") != false)
                throw new InvalidOperationException($"Profile operation '{field.Name}' requires native conversion; it cannot be omitted from an exported standard.");
        var executionOptions = ConvertExecutionOptions(composed["ExecutionOptions"]);
        var familyFilter = composed["FilterFamilies"];
        ScheduleFilterSpec? includeByCondition = null;
        if (familyFilter?["IncludeByCondition"] is JObject condition) {
            RequireOnly(condition, "FilterFamilies.IncludeByCondition", "FieldName", "FilterType", "Value");
            if (!string.IsNullOrWhiteSpace((string?)condition["FieldName"])) {
                includeByCondition = condition.ToObject<ScheduleFilterSpec>()!;
                if (!Enum.IsDefined(typeof(ScheduleAuthoredFilterType), includeByCondition.FilterType))
                    throw new InvalidOperationException($"FilterFamilies.IncludeByCondition has unknown FilterType '{condition["FilterType"]}'.");
            } else if (!string.IsNullOrWhiteSpace((string?)condition["Value"]))
                throw new InvalidOperationException("FilterFamilies.IncludeByCondition requires FieldName when Value is set.");
        } else if (familyFilter?["IncludeByCondition"] is { Type: not JTokenType.Null })
            throw new InvalidOperationException("FilterFamilies.IncludeByCondition must be an object.");
        var older = composed["SharedParameterSelection"];
        var filter = composed["FilterApsParams"];
        var include = filter?["IncludeNames"] ?? older?["Include"];
        var selected = definitions.Where(d => (!d.IsArchived || (include?["Equaling"] ?? include?["Names"])?.Values<string>().Contains(d.Name) == true) && Matches(d.Name!, include, true) &&
            !Matches(d.Name!, filter?["ExcludeNames"] ?? older?["Exclude"], false)).ToList();
        var mappings = composed["AddAndMapSharedParams"]?.ToObject<MapParamsSettings>() ?? new MapParamsSettings {
            Enabled = composed["MappingData"] is not null, MappingData = composed["MappingData"]?.ToObject<List<MappingData>>() ?? [] };
        var exported = ExportSharedMappings(mappings, selected, clean: composed["CleanFamilyDocument"]?.ToObject<CleanFamilyDocumentSettings>(),
            sort: composed["SortParams"]?.ToObject<SortParamsSettings>(), electricalConnectorParameters: ElectricalConnectorRule(composed["MakeElectricalConnector"]));
        var parameters = (JObject)exported.Patch["parameters"]!;
        var specs = selected.ToDictionary(d => d.Name!, d => d.DownloadOptions.GetSpecTypeId(), StringComparer.Ordinal);
        if (composed["AddFamilyParams"] is JObject add && add.Value<bool?>("Enabled") != false) {
            foreach (var local in add["Parameters"] ?? new JArray()) {
                var name = (string)local["Name"]!;
                var label = (string?)local["DataType"] ?? "Text (Common)";
                var spec = RevitLabelCatalog.ResolveSpec(label);
                specs[name] = spec;
                var parameter = new JObject {
                    ["dataType"] = Enum.GetValues(typeof(DataType)).Cast<DataType>().First(t => SetParamMetadata.Spec(t) == spec).ToString()
                };
                if (local["PropertiesGroup"] is { Type: not JTokenType.Null } group)
                    parameter["propertiesGroup"] = SetParamMetadata.Group(((string?)group)!).TypeId;
                parameters[name] = parameter;
                if (local["IsInstance"] is not null) parameter["isInstance"] = local["IsInstance"]!.DeepClone();
                if (local["Tooltip"] is { Type: JTokenType.String } tooltip) parameter["tooltip"] = tooltip.DeepClone();
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
                var parameter = CanonicalParameterName(assignment.Parameter);
                if (parameters[parameter] is null) parameters[parameter] =
                    exported.Run?.ParametersIfSourceExists?.TryGetValue(parameter, out var conditional) == true
                        ? JObject.FromObject(conditional, JsonSerializer.Create(FamilyModelJson.Settings)) : new JObject();
                parameters[parameter]![assignment.Kind == ParamAssignmentKind.Formula ? "formula" : "value"] =
                    assignment.Kind == ParamAssignmentKind.Formula ? assignment.Value : Literal(parameter, assignment.Value, specs, sourceUnits);
            }
            var types = new JObject();
            foreach (var (parameter, cells) in assignments.GetPerTypeAssignmentsByParameter())
                foreach (var (type, value) in cells) {
                    types[type] ??= new JObject();
                    var canonical = CanonicalParameterName(parameter);
                    types[type]![canonical] = Literal(canonical, value, specs, sourceUnits);
                }
            if (types.HasValues) exported.Patch["types"] = types;
        }
        if (composed["DeleteParams"]?.ToObject<DeleteParamsSettings>() is { Enabled: true } deletes)
            foreach (var name in deletes.Names) parameters[CanonicalParameterName(name)] = JValue.CreateNull();
        if (composed["AddRoomDingler"]?.ToObject<AddRoomDinglerSettings>() is { Enabled: true } room)
            exported.Patch["roomCalculationPoint"] = JObject.FromObject(new FamilyModelRoomCalculationPoint { Enabled = true, Offset = PortableLength.FromFeet(room.OffsetFeet) }, JsonSerializer.Create(FamilyModelJson.Settings));
        ConvertReferencePlanes(composed["MakeRefPlaneAndDims"], exported.Patch);
        ConvertParamDrivenSolids(composed["ParamDrivenSolids"], exported.Patch);
        ConvertLookupTables(composed["SetLookupTables"], exported.Patch);
        return new FamilyProfileConversion(new FamilyPatch { Patch = exported.Patch, Run = exported.Run, Select = new PatchSelect {
            IncludeNames = familyFilter?["IncludeNames"]?.ToObject<IncludeFamilies>(),
            ExcludeNames = familyFilter?["ExcludeNames"]?.ToObject<ExcludeFamilies>(),
            IncludeByCondition = includeByCondition,
            Categories = familyFilter?["IncludeCategoriesEqualing"]?.ToObject<List<FamilyCategory>>(JsonSerializer.Create(FamilyModelJson.Settings)),
            PlacedOnly = familyFilter?.Value<bool?>("IncludeUnusedFamilies") == false ? true : null
        } }, executionOptions);
    }

    private static void ConvertParamDrivenSolids(JToken? token, JObject patch) {
        if (token is null) return;
        if (token is not JObject operation) throw new InvalidOperationException("ParamDrivenSolids must be an object.");
        if (!operation.HasValues) return; // Frozen HPWH deliberately authors the validated empty/no-op shape.
        if (operation["Rectangles"] is null && (operation["Frame"] is not null || operation["Planes"] is not null || operation["Spans"] is not null || operation["Prisms"] is not null)) {
            ConvertAuthoredParamDrivenSolids(operation, patch);
            return;
        }
        RequireOnly(operation, "ParamDrivenSolids", "Enabled", "Frame", "Rectangles", "Cylinders", "Connectors");
        if (operation["Frame"] is JObject frame) {
            RequireOnly(frame, "ParamDrivenSolids.Frame", "Kind");
            if (Required(frame, "Kind", "ParamDrivenSolids.Frame") != "NonHosted") throw new InvalidOperationException("ParamDrivenSolids.Frame.Kind requires native conversion.");
        } else if (operation["Frame"] is not null) throw new InvalidOperationException("ParamDrivenSolids.Frame must be an object.");
        if (operation["Enabled"] is { Type: not JTokenType.Boolean }) throw new InvalidOperationException("ParamDrivenSolids.Enabled must be a boolean.");
        if (operation.Value<bool?>("Enabled") == false) return;
        foreach (var field in new[] { "Rectangles", "Cylinders", "Connectors" })
            if (operation[field] is { } value && value is not JArray)
                throw new InvalidOperationException($"ParamDrivenSolids.{field} must be an array.");
        var rectangles = operation["Rectangles"] as JArray ?? [];
        var cylinders = operation["Cylinders"] as JArray ?? [];
        var connectors = operation["Connectors"] as JArray ?? [];
        if (cylinders.Count > 0) throw new InvalidOperationException("ParamDrivenSolids.Cylinders require lossless native conversion.");
        if (rectangles.Count == 0) throw new InvalidOperationException("Active ParamDrivenSolids has no populated geometry.");
        if (rectangles.Any(x => x is not JObject)) throw new InvalidOperationException("ParamDrivenSolids.Rectangles entries must be objects.");

        var planes = patch["refPlanes"] as JObject ?? new JObject();
        var dimensions = patch["dimensions"] as JObject ?? new JObject();
        var forms = patch["forms"] as JObject ?? new JObject();
        var nativeConnectors = patch["connectors"] as JObject ?? new JObject();
        var serializer = JsonSerializer.Create(FamilyModelJson.Settings);
        var index = 0;
        var aliases = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var rectangle in rectangles.OfType<JObject>()) {
            RequireOnly(rectangle, "ParamDrivenSolids.Rectangle", "Name", "IsSolid", "Sketch", "Width", "Length", "Height");
            if (rectangle["IsSolid"] is { Type: not JTokenType.Boolean }) throw new InvalidOperationException("ParamDrivenSolids.Rectangle.IsSolid must be a boolean.");
            var name = Required(rectangle, "Name", "ParamDrivenSolids.Rectangle");
            var sketch = RequiredObject(rectangle, "Sketch", "ParamDrivenSolids.Rectangle");
            var sketchPlane = LegacySketchPlane(sketch, aliases);
            var width = LegacyMirror(RequiredObject(rectangle, "Width", "ParamDrivenSolids.Rectangle"), "Width", aliases);
            var length = LegacyMirror(RequiredObject(rectangle, "Length", "ParamDrivenSolids.Rectangle"), "Length", aliases);
            var height = LegacyOffset(RequiredObject(rectangle, "Height", "ParamDrivenSolids.Rectangle"), aliases);
            var widthAxis = AxisFor(width.Anchor);
            var lengthAxis = AxisFor(length.Anchor);
            if (widthAxis == lengthAxis) throw new InvalidOperationException($"ParamDrivenSolids.Rectangle '{name}' width and length use the same axis.");
            var (w0, w1) = PlanePair(width.Base, widthAxis);
            var (l0, l1) = PlanePair(length.Base, lengthAxis);
            aliases[$"{name}.Width.Back"] = w0; aliases[$"{name}.Width.Front"] = w1;
            aliases[$"{name}.Length.Left"] = l0; aliases[$"{name}.Length.Right"] = l1;
            aliases[$"{name}.Height.Top"] = height.Name;
            AddPlane(planes, w0, new FamilyModelRefPlane { Normal = widthAxis, At = PortableLength.FromFeet(-0.5), IsReference = width.Strength }, serializer);
            AddPlane(planes, w1, new FamilyModelRefPlane { Normal = widthAxis, At = PortableLength.FromFeet(0.5), IsReference = width.Strength }, serializer);
            AddPlane(planes, l0, new FamilyModelRefPlane { Normal = lengthAxis, At = PortableLength.FromFeet(-0.5), IsReference = length.Strength }, serializer);
            AddPlane(planes, l1, new FamilyModelRefPlane { Normal = lengthAxis, At = PortableLength.FromFeet(0.5), IsReference = length.Strength }, serializer);
            AddPlane(planes, height.Name, new FamilyModelRefPlane { Normal = AxisFor(height.Anchor), At = PortableLength.FromFeet(height.Positive ? 1 : -1), IsReference = height.Strength }, serializer);
            AddUnique(dimensions, $"legacy-solid-{index}-width", JObject.FromObject(new FamilyModelDim { Between = [w0, w1], Label = width.Parameter }, serializer));
            AddUnique(dimensions, $"legacy-solid-{index}-width-eq", JObject.FromObject(new FamilyModelDim { Between = [w0, width.Anchor, w1], Equality = true }, serializer));
            AddUnique(dimensions, $"legacy-solid-{index}-length", JObject.FromObject(new FamilyModelDim { Between = [l0, l1], Label = length.Parameter }, serializer));
            AddUnique(dimensions, $"legacy-solid-{index}-length-eq", JObject.FromObject(new FamilyModelDim { Between = [l0, length.Anchor, l1], Equality = true }, serializer));
            AddUnique(dimensions, $"legacy-solid-{index++}-height", JObject.FromObject(new FamilyModelDim { Between = [height.Anchor, height.Name], Label = height.Parameter }, serializer));
            AddUnique(forms, name, JObject.FromObject(new FamilyModelForm {
                Kind = FormKind.Extrusion, Void = rectangle.Value<bool?>("IsSolid") == false,
                SketchPlane = sketchPlane, Start = height.Anchor, End = height.Name,
                Profile = [new FamilyModelLoop { Curves = new[] { w0, l1, w1, l0 }.Select(p => new FamilyModelSketchCurve { Kind = CurveKind.Line, On = p }).ToList() }]
            }, serializer));
        }
        ConvertLegacyConnectors(connectors, planes, dimensions, forms, nativeConnectors, aliases, serializer, ref index);
        patch["refPlanes"] = planes;
        patch["dimensions"] = dimensions;
        patch["forms"] = forms;
        patch["connectors"] = nativeConnectors;
    }

    private static void ConvertAuthoredParamDrivenSolids(JObject operation, JObject patch) {
        RequireOnly(operation, "ParamDrivenSolids", "Frame", "Planes", "Spans", "Prisms", "Cylinders", "Connectors");
        if (Required(operation, "Frame", "ParamDrivenSolids") != "NonHosted")
            throw new InvalidOperationException("ParamDrivenSolids.Frame requires native conversion.");
        var serializer = JsonSerializer.Create(FamilyModelJson.Settings);
        var planes = patch["refPlanes"] as JObject ?? new JObject();
        var dimensions = patch["dimensions"] as JObject ?? new JObject();
        var forms = patch["forms"] as JObject ?? new JObject();
        var connectors = patch["connectors"] as JObject ?? new JObject();
        var axes = new Dictionary<string, Axis>(StringComparer.Ordinal) {
            ["Center (Left/Right)"] = Axis.PlusX, ["Left"] = Axis.PlusX, ["Right"] = Axis.PlusX,
            ["Center (Front/Back)"] = Axis.PlusY, ["Back"] = Axis.PlusY, ["Front"] = Axis.PlusY,
            ["Reference Plane"] = Axis.PlusZ, ["Top"] = Axis.PlusZ, ["Bottom"] = Axis.PlusZ
        };
        var dimIndex = 0;

        if (operation["Planes"] is not JObject authoredPlanes) throw new InvalidOperationException("ParamDrivenSolids.Planes must be an object.");
        foreach (var property in authoredPlanes.Properties()) {
            if (property.Value is not JObject spec) throw new InvalidOperationException($"ParamDrivenSolids.Planes.{property.Name} must be an object.");
            AddAuthoredOffset(property.Name, spec, planes, dimensions, axes, serializer, ref dimIndex);
        }
        foreach (var span in RequiredArray(operation, "Spans", "ParamDrivenSolids").OfType<JObject>())
            AddAuthoredSpan(span, planes, dimensions, axes, serializer, ref dimIndex);
        EnsureObjects(RequiredArray(operation, "Spans", "ParamDrivenSolids"), "ParamDrivenSolids.Spans");

        var prisms = RequiredArray(operation, "Prisms", "ParamDrivenSolids");
        EnsureObjects(prisms, "ParamDrivenSolids.Prisms");
        foreach (var prism in prisms.OfType<JObject>()) {
            RequireOnly(prism, "ParamDrivenSolids.Prism", "Name", "IsSolid", "On", "Width", "Length", "Height");
            StrictBool(prism, "IsSolid", "ParamDrivenSolids.Prism");
            var name = Required(prism, "Name", "ParamDrivenSolids.Prism");
            var width = AddAuthoredSpan(RequiredObject(prism, "Width", "ParamDrivenSolids.Prism"), planes, dimensions, axes, serializer, ref dimIndex);
            var length = AddAuthoredSpan(RequiredObject(prism, "Length", "ParamDrivenSolids.Prism"), planes, dimensions, axes, serializer, ref dimIndex);
            var height = RequiredObject(prism, "Height", "ParamDrivenSolids.Prism");
            var top = Required(height, "Name", "ParamDrivenSolids.Prism.Height");
            AddAuthoredOffset(top, height, planes, dimensions, axes, serializer, ref dimIndex);
            AddRectangleForm(forms, name, ResolvePlane(Required(prism, "On", "ParamDrivenSolids.Prism")), top, width, length,
                prism.Value<bool?>("IsSolid") != false, serializer);
        }

        var cylinders = RequiredArray(operation, "Cylinders", "ParamDrivenSolids");
        EnsureObjects(cylinders, "ParamDrivenSolids.Cylinders");
        foreach (var cylinder in cylinders.OfType<JObject>()) {
            RequireOnly(cylinder, "ParamDrivenSolids.Cylinder", "Name", "IsSolid", "On", "Center", "Diameter", "Height");
            StrictBool(cylinder, "IsSolid", "ParamDrivenSolids.Cylinder");
            var name = Required(cylinder, "Name", "ParamDrivenSolids.Cylinder");
            var bottom = ResolvePlane(Required(cylinder, "On", "ParamDrivenSolids.Cylinder"));
            var center = PlaneRefs(RequiredArray(cylinder, "Center", "ParamDrivenSolids.Cylinder"), "ParamDrivenSolids.Cylinder.Center");
            var diameter = Driver(RequiredObject(cylinder, "Diameter", "ParamDrivenSolids.Cylinder"), "ParamDrivenSolids.Cylinder.Diameter");
            var height = RequiredObject(cylinder, "Height", "ParamDrivenSolids.Cylinder");
            RequireOnly(height, "ParamDrivenSolids.Cylinder.Height", "Name", "From", "By", "Dir");
            var top = height.Value<string>("Name") ?? $"{name}.top";
            var offset = (JObject)height.DeepClone();
            offset["From"] ??= Required(cylinder, "On", "ParamDrivenSolids.Cylinder");
            AddAuthoredOffset(top, offset, planes, dimensions, axes, serializer, ref dimIndex);
            AddCircleForm(forms, name, bottom, top, center, diameter, cylinder.Value<bool?>("IsSolid") != false, serializer);
        }

        var authoredConnectors = RequiredArray(operation, "Connectors", "ParamDrivenSolids");
        EnsureObjects(authoredConnectors, "ParamDrivenSolids.Connectors");
        foreach (var connector in authoredConnectors.OfType<JObject>()) {
            RequireOnly(connector, "ParamDrivenSolids.Connector", "Name", "Domain", "Face", "Depth", "IsSolid", "Round", "Config");
            StrictBool(connector, "IsSolid", "ParamDrivenSolids.Connector");
            var name = Required(connector, "Name", "ParamDrivenSolids.Connector");
            var host = ResolvePlane(Required(connector, "Face", "ParamDrivenSolids.Connector"));
            var face = $"{name} Face";
            var depth = RequiredObject(connector, "Depth", "ParamDrivenSolids.Connector");
            var faceSpec = (JObject)depth.DeepClone();
            faceSpec["From"] = connector["Face"]!.DeepClone();
            AddAuthoredOffset(face, faceSpec, planes, dimensions, axes, serializer, ref dimIndex);
            var round = RequiredObject(connector, "Round", "ParamDrivenSolids.Connector");
            RequireOnly(round, "ParamDrivenSolids.Connector.Round", "Center", "Diameter");
            var center = PlaneRefs(RequiredArray(round, "Center", "ParamDrivenSolids.Connector.Round"), "ParamDrivenSolids.Connector.Round.Center");
            var diameter = Driver(RequiredObject(round, "Diameter", "ParamDrivenSolids.Connector.Round"), "ParamDrivenSolids.Connector.Round.Diameter");
            AddCircleForm(forms, $"{name} Stub", host, face, center, diameter, connector.Value<bool?>("IsSolid") != false, serializer);
            var config = RequiredObject(connector, "Config", "ParamDrivenSolids.Connector");
            RequireOnly(config, "ParamDrivenSolids.Connector.Config", "SystemType", "FlowConfiguration", "FlowDirection", "LossMethod");
            var native = new JObject {
                ["domain"] = Required(connector, "Domain", "ParamDrivenSolids.Connector"), ["systemType"] = Required(config, "SystemType", "ParamDrivenSolids.Connector.Config"),
                ["on"] = face, ["at"] = new JArray(center), ["shape"] = "Round", ["diameter"] = diameter.Text
            };
            foreach (var field in new[] { "FlowConfiguration", "FlowDirection", "LossMethod" })
                if (config[field] is { } value) {
                    if (value.Type != JTokenType.String) throw new InvalidOperationException($"ParamDrivenSolids.Connector.Config.{field} must be a string.");
                    native[char.ToLowerInvariant(field[0]) + field[1..]] = value.DeepClone();
                }
            AddUnique(connectors, name, native);
        }
        patch["refPlanes"] = planes;
        patch["dimensions"] = dimensions;
        patch["forms"] = forms;
        patch["connectors"] = connectors;
    }

    private static void ConvertLegacyConnectors(JArray authored, JObject planes, JObject dimensions, JObject forms, JObject connectors,
        IReadOnlyDictionary<string, string> aliases, JsonSerializer serializer, ref int index) {
        EnsureObjects(authored, "ParamDrivenSolids.Connectors");
        foreach (var connector in authored.OfType<JObject>()) {
            RequireOnly(connector, "ParamDrivenSolids.Connector", "Name", "Domain", "Host", "Geometry", "Bindings", "Config");
            var name = Required(connector, "Name", "ParamDrivenSolids.Connector");
            var host = RequiredObject(connector, "Host", "ParamDrivenSolids.Connector");
            RequireOnly(host, "ParamDrivenSolids.Connector.Host", "SketchPlane", "Depth");
            var sketch = LegacyReference(host["SketchPlane"] ?? throw new InvalidOperationException("ParamDrivenSolids.Connector.Host requires SketchPlane."), aliases);
            var depth = LegacyOffset(RequiredObject(host, "Depth", "ParamDrivenSolids.Connector.Host"), aliases);
            if (depth.Anchor != sketch) throw new InvalidOperationException($"ParamDrivenSolids connector '{name}' depth anchor differs from its sketch plane.");
            var axis = PlaneAxis(planes, depth.Anchor, serializer);
            AddPlane(planes, depth.Name, new FamilyModelRefPlane { Normal = axis, At = PortableLength.FromFeet(depth.Positive ? 1 : -1), IsReference = depth.Strength }, serializer);
            AddDrivenDimension(dimensions, $"legacy-solid-{index++}-connector-depth", [depth.Anchor, depth.Name], PortableLength.Parse($"param:{depth.Parameter}"), serializer);

            var geometry = RequiredObject(connector, "Geometry", "ParamDrivenSolids.Connector");
            RequireOnly(geometry, "ParamDrivenSolids.Connector.Geometry", "Profile", "CenterLeftRightPlane", "CenterFrontBackPlane", "Diameter");
            if (Required(geometry, "Profile", "ParamDrivenSolids.Connector.Geometry") != "Round") throw new InvalidOperationException("Only corpus round connector geometry is supported.");
            var centers = new[] { "CenterLeftRightPlane", "CenterFrontBackPlane" }.Select(field =>
                LegacyReference(geometry[field] ?? throw new InvalidOperationException($"ParamDrivenSolids.Connector.Geometry requires {field}."), aliases)).ToList();
            var diameterSpec = RequiredObject(geometry, "Diameter", "ParamDrivenSolids.Connector.Geometry");
            var diameter = LegacyMirror(diameterSpec, "Diameter", aliases);
            if (!centers.Contains(diameter.Anchor, StringComparer.Ordinal)) throw new InvalidOperationException($"ParamDrivenSolids connector '{name}' diameter anchor is not a center plane.");
            AddCircleForm(forms, $"{name} Stub", sketch, depth.Name, centers, PortableLength.Parse($"param:{diameter.Parameter}"), true, serializer);

            var domain = Required(connector, "Domain", "ParamDrivenSolids.Connector");
            var config = RequiredObject(connector, "Config", "ParamDrivenSolids.Connector");
            RequireOnly(config, "ParamDrivenSolids.Connector.Config", domain);
            var domainConfig = RequiredObject(config, domain, "ParamDrivenSolids.Connector.Config");
            var allowed = domain == "Duct" ? new[] { "SystemType", "FlowConfiguration", "FlowDirection", "LossMethod" }
                : domain == "Pipe" ? new[] { "SystemType", "FlowConfiguration", "FlowDirection" } : domain == "Electrical" ? new[] { "SystemType" }
                : throw new InvalidOperationException($"ParamDrivenSolids connector domain '{domain}' requires native conversion.");
            RequireOnly(domainConfig, $"ParamDrivenSolids.Connector.Config.{domain}", allowed);
            var system = Required(domainConfig, "SystemType", $"ParamDrivenSolids.Connector.Config.{domain}") switch {
                "SupplyHydronic" => "HydronicSupply", "ReturnHydronic" => "HydronicReturn", var value => value
            };
            var native = new JObject { ["domain"] = domain, ["systemType"] = system, ["on"] = depth.Name,
                ["at"] = new JArray(centers) };
            if (domain != "Electrical") { native["shape"] = "Round"; native["diameter"] = $"param:{diameter.Parameter}"; }
            foreach (var field in new[] { "FlowConfiguration", "FlowDirection", "LossMethod" })
                if (domainConfig[field] is { } value) {
                    if (value.Type != JTokenType.String) throw new InvalidOperationException($"ParamDrivenSolids.Connector.Config.{domain}.{field} must be a string.");
                    native[char.ToLowerInvariant(field[0]) + field[1..]] = value.DeepClone();
                }
            if (domain == "Pipe" && native["flowDirection"] is null) native["flowDirection"] = "Bidirectional";
            if (connector["Bindings"] is JObject bindings) {
                RequireOnly(bindings, "ParamDrivenSolids.Connector.Bindings", "Parameters");
                var parameters = RequiredArray(bindings, "Parameters", "ParamDrivenSolids.Connector.Bindings");
                EnsureObjects(parameters, "ParamDrivenSolids.Connector.Bindings.Parameters");
                var associate = new JObject();
                foreach (var binding in parameters.OfType<JObject>()) {
                    RequireOnly(binding, "ParamDrivenSolids.Connector.Binding", "Target", "SourceParameter");
                    var target = Required(binding, "Target", "ParamDrivenSolids.Connector.Binding") switch { "NumberOfPoles" => "Number of Poles", var value => value };
                    AddUnique(associate, target,
                        $"param:{Required(binding, "SourceParameter", "ParamDrivenSolids.Connector.Binding")}");
                }
                native["associate"] = associate;
            }
            AddUnique(connectors, name, native);
        }
    }

    private static string LegacySketchPlane(JObject value, IReadOnlyDictionary<string, string> aliases) {
        if (value["Frame"] is { } frame) {
            RequireOnly(value, "ParamDrivenSolids.Rectangle.Sketch", "Frame");
            return LegacyReference(new JObject { ["Frame"] = frame.DeepClone() }, aliases);
        }
        RequireOnly(value, "ParamDrivenSolids.Rectangle.Sketch", "Kind", "Plane");
        if (Required(value, "Kind", "ParamDrivenSolids.Rectangle.Sketch") != "ReferencePlane") throw new InvalidOperationException("ParamDrivenSolids.Rectangle.Sketch.Kind requires native conversion.");
        return Required(value, "Plane", "ParamDrivenSolids.Rectangle.Sketch");
    }

    private static (string Base, string Anchor, string Parameter, RefStrength Strength) LegacyMirror(JObject value, string axis, IReadOnlyDictionary<string, string> aliases) {
        RequireOnly(value, $"ParamDrivenSolids.Rectangle.{axis}", "Mode", "Parameter", "CenterAnchor", "PlaneNameBase", "Strength");
        if (Required(value, "Mode", $"ParamDrivenSolids.Rectangle.{axis}") != "Mirror")
            throw new InvalidOperationException($"ParamDrivenSolids.Rectangle.{axis}.Mode requires native conversion.");
        return (Required(value, "PlaneNameBase", $"ParamDrivenSolids.Rectangle.{axis}"), LegacyReference(value["CenterAnchor"] ?? throw new InvalidOperationException($"ParamDrivenSolids.Rectangle.{axis} requires CenterAnchor."), aliases),
            Required(value, "Parameter", $"ParamDrivenSolids.Rectangle.{axis}"), Strength(value));
    }

    private static (string Name, string Anchor, string Parameter, bool Positive, RefStrength Strength) LegacyOffset(JObject value, IReadOnlyDictionary<string, string> aliases) {
        RequireOnly(value, "ParamDrivenSolids.Rectangle.Height", "Mode", "Parameter", "Anchor", "Direction", "PlaneNameBase", "Strength");
        if (Required(value, "Mode", "ParamDrivenSolids.Rectangle.Height") != "Offset")
            throw new InvalidOperationException("ParamDrivenSolids.Rectangle.Height.Mode requires native conversion.");
        var direction = Required(value, "Direction", "ParamDrivenSolids.Rectangle.Height");
        if (direction is not "Positive" and not "Negative") throw new InvalidOperationException($"Unknown ParamDrivenSolids height direction '{direction}'.");
        return (Required(value, "PlaneNameBase", "ParamDrivenSolids.Rectangle.Height"), LegacyReference(value["Anchor"] ?? throw new InvalidOperationException("ParamDrivenSolids.Rectangle.Height requires Anchor."), aliases),
            Required(value, "Parameter", "ParamDrivenSolids.Rectangle.Height"), direction == "Positive", Strength(value));
    }

    private static (string Negative, string Positive) PlanePair(string name, Axis axis) => axis switch {
        Axis.PlusX => ($"{name} (Left)", $"{name} (Right)"), Axis.PlusY => ($"{name} (Back)", $"{name} (Front)"),
        Axis.PlusZ => ($"{name} (Bottom)", $"{name} (Top)"), _ => throw new InvalidOperationException($"Unsupported ParamDrivenSolids axis '{axis}'.")
    };

    private static string LegacyReference(JToken value, IReadOnlyDictionary<string, string> aliases) {
        if (value.Type == JTokenType.String) {
            var name = (string)value;
            return aliases.TryGetValue(name, out var resolved) ? resolved : name;
        }
        if (value is not JObject reference || reference.Properties().Count() != 1) throw new InvalidOperationException("Legacy plane reference must be a string or one reference object.");
        if (reference["Frame"] is JObject frame) {
            RequireOnly(frame, "Legacy Frame reference", "Plane");
            return Required(frame, "Plane", "Legacy Frame reference") switch {
                "CenterLR" => "Center (Left/Right)", "CenterFB" => "Center (Front/Back)", "Bottom" => "Reference Plane", var name => name
            };
        }
        if (reference["Semantic"] is JObject semantic) {
            RequireOnly(semantic, "Legacy Semantic reference", "Name");
            return Required(semantic, "Name", "Legacy Semantic reference");
        }
        if (reference["Derived"] is JObject derived) {
            RequireOnly(derived, "Legacy Derived reference", "Solid", "Face");
            var solid = Required(derived, "Solid", "Legacy Derived reference");
            var face = Required(derived, "Face", "Legacy Derived reference");
            var key = face switch { "Left" or "Right" => $"{solid}.Length.{face}", "Back" or "Front" => $"{solid}.Width.{face}", "Top" => $"{solid}.Height.Top", _ => throw new InvalidOperationException($"Legacy derived face '{face}' requires native conversion.") };
            return aliases.TryGetValue(key, out var result) ? result : throw new InvalidOperationException($"Legacy derived reference '{key}' has no converted solid.");
        }
        throw new InvalidOperationException($"Legacy plane reference field '{reference.Properties().Single().Name}' requires native conversion.");
    }

    private static Axis PlaneAxis(JObject planes, string name, JsonSerializer serializer) {
        if (planes[name]?.ToObject<FamilyModelRefPlane>(serializer) is { } plane) return plane.Normal;
        return AxisFor(name);
    }

    private static void ConvertLookupTables(JToken? token, JObject patch) {
        if (token is null) return;
        if (token is not JObject operation) throw new InvalidOperationException("SetLookupTables must be an object.");
        RequireOnly(operation, "SetLookupTables", "Enabled", "ReplaceExisting", "Tables");
        StrictBool(operation, "Enabled", "SetLookupTables");
        StrictBool(operation, "ReplaceExisting", "SetLookupTables");
        if (operation.Value<bool?>("Enabled") == false) return;
        var tables = RequiredArray(operation, "Tables", "SetLookupTables");
        EnsureObjects(tables, "SetLookupTables.Tables");
        if (tables.Count == 0) return; // Frozen Grinder profile: validated active no-op.
        if (operation.Value<bool?>("ReplaceExisting") == false) throw new InvalidOperationException("Populated SetLookupTables with ReplaceExisting=false has no native patch semantics.");
        var native = patch["lookupTables"] as JObject ?? new JObject();
        foreach (var table in tables.OfType<JObject>()) {
            var definition = table.ToObject<LookupTableDefinition>(JsonSerializer.Create(new JsonSerializerSettings { MissingMemberHandling = MissingMemberHandling.Error }))
                ?? throw new InvalidOperationException("SetLookupTables table could not be read.");
            AddUnique(native, definition.Schema.Name, new JObject { ["csv"] = LookupTableCsvCodec.Encode(definition) });
        }
        patch["lookupTables"] = native;
    }

    private static JObject RequiredObject(JObject value, string field, string path) =>
        value[field] is JObject result ? result : throw new InvalidOperationException($"{path} requires object {field}.");

    private static void AddUnique(JObject values, string name, JToken value) {
        if (values.ContainsKey(name)) throw new InvalidOperationException($"ParamDrivenSolids generates duplicate native name '{name}'.");
        values[name] = value;
    }

    private static void AddAuthoredOffset(string name, JObject spec, JObject planes, JObject dimensions,
        IDictionary<string, Axis> axes, JsonSerializer serializer, ref int index) {
        RequireOnly(spec, "ParamDrivenSolids offset", "Name", "From", "By", "Dir");
        if (spec["Name"] is not null && Required(spec, "Name", "ParamDrivenSolids offset") != name)
            throw new InvalidOperationException($"ParamDrivenSolids offset name '{name}' conflicts with '{spec["Name"]}'.");
        var anchor = ResolvePlane(Required(spec, "From", "ParamDrivenSolids offset"));
        var direction = Required(spec, "Dir", "ParamDrivenSolids offset");
        if (direction is not "out" and not "in") throw new InvalidOperationException($"ParamDrivenSolids offset Dir '{direction}' is invalid.");
        if (!axes.TryGetValue(anchor, out var axis)) throw new InvalidOperationException($"ParamDrivenSolids offset anchor '{anchor}' has no resolved native axis.");
        AddPlane(planes, name, new FamilyModelRefPlane { Normal = axis, At = PortableLength.FromFeet(direction == "out" ? 1 : -1), IsReference = RefStrength.StrongReference }, serializer);
        axes[name] = axis;
        AddDrivenDimension(dimensions, $"authored-solid-{index++}", [anchor, name], Driver(spec, "ParamDrivenSolids offset"), serializer);
    }

    private static (string Negative, string Positive) AddAuthoredSpan(JObject spec, JObject planes, JObject dimensions,
        IDictionary<string, Axis> axes, JsonSerializer serializer, ref int index) {
        RequireOnly(spec, "ParamDrivenSolids span", "About", "By", "Negative", "Positive");
        var about = ResolvePlane(Required(spec, "About", "ParamDrivenSolids span"));
        if (!axes.TryGetValue(about, out var axis)) throw new InvalidOperationException($"ParamDrivenSolids span anchor '{about}' has no resolved native axis.");
        var negative = Required(spec, "Negative", "ParamDrivenSolids span");
        var positive = Required(spec, "Positive", "ParamDrivenSolids span");
        AddPlane(planes, negative, new FamilyModelRefPlane { Normal = axis, At = PortableLength.FromFeet(-0.5), IsReference = RefStrength.StrongReference }, serializer);
        AddPlane(planes, positive, new FamilyModelRefPlane { Normal = axis, At = PortableLength.FromFeet(0.5), IsReference = RefStrength.StrongReference }, serializer);
        axes[negative] = axes[positive] = axis;
        AddDrivenDimension(dimensions, $"authored-solid-{index++}", [negative, positive], Driver(spec, "ParamDrivenSolids span"), serializer);
        AddUnique(dimensions, $"authored-solid-{index++}-eq", JObject.FromObject(new FamilyModelDim { Between = [negative, about, positive], Equality = true }, serializer));
        return (negative, positive);
    }

    private static void AddDrivenDimension(JObject dimensions, string name, List<string> between, PortableLength driver, JsonSerializer serializer) =>
        AddUnique(dimensions, name, JObject.FromObject(driver.IsParameter
            ? new FamilyModelDim { Between = between, Label = driver.Parameter }
            : new FamilyModelDim { Between = between, Locked = driver }, serializer));

    private static void AddRectangleForm(JObject forms, string name, string bottom, string top,
        (string Negative, string Positive) width, (string Negative, string Positive) length, bool solid, JsonSerializer serializer) =>
        AddUnique(forms, name, JObject.FromObject(new FamilyModelForm {
            Kind = FormKind.Extrusion, Void = !solid, SketchPlane = bottom, Start = bottom, End = top,
            Profile = [new FamilyModelLoop { Curves = new[] { width.Negative, length.Positive, width.Positive, length.Negative }
                .Select(p => new FamilyModelSketchCurve { Kind = CurveKind.Line, On = p }).ToList() }]
        }, serializer));

    private static void AddCircleForm(JObject forms, string name, string bottom, string top, List<string> center,
        PortableLength diameter, bool solid, JsonSerializer serializer) =>
        AddUnique(forms, name, JObject.FromObject(new FamilyModelForm {
            Kind = FormKind.Extrusion, Void = !solid, SketchPlane = bottom, Start = bottom, End = top,
            Profile = [new FamilyModelLoop { Curves = [new FamilyModelSketchCurve { Kind = CurveKind.Circle, Center = center, Diameter = diameter }] }]
        }, serializer));

    private static PortableLength Driver(JObject value, string path) {
        try { return PortableLength.Parse(Required(value, "By", path)); }
        catch (JsonSerializationException error) { throw new InvalidOperationException($"{path}.By is invalid: {error.Message}", error); }
    }

    private static JArray RequiredArray(JObject value, string field, string path) =>
        value[field] is JArray result ? result : throw new InvalidOperationException($"{path}.{field} must be an array.");

    private static void EnsureObjects(JArray values, string path) {
        if (values.Any(value => value is not JObject)) throw new InvalidOperationException($"{path} entries must be objects.");
    }

    private static List<string> PlaneRefs(JArray values, string path) {
        if (values.Count != 2 || values.Any(value => value.Type != JTokenType.String)) throw new InvalidOperationException($"{path} must contain two plane strings.");
        return values.Values<string>().Select(ResolvePlane).ToList();
    }

    private static void StrictBool(JObject value, string field, string path) {
        if (value[field] is { Type: not JTokenType.Boolean }) throw new InvalidOperationException($"{path}.{field} must be a boolean.");
    }

    private static string ResolvePlane(string value) => value switch {
        "@CenterLR" => "Center (Left/Right)", "@CenterFB" => "Center (Front/Back)", "@Bottom" => "Reference Plane",
        "@Left" => "Left", "@Right" => "Right", "@Top" => "Top", _ when value.StartsWith("plane:", StringComparison.Ordinal) => value[6..], _ => value
    };

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

    private static string Required(JObject value, string field, string path) =>
        value[field]?.Type == JTokenType.String && (string?)value[field] is { Length: > 0 } result
            ? result : throw new InvalidOperationException($"{path} requires string {field}.");

    private static void RequireOnly(JObject value, string kind, params string[] fields) {
        var unknown = value.Properties().Where(p => !fields.Contains(p.Name, StringComparer.Ordinal)).Select(p => p.Name).ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"{kind} fields require native conversion: {string.Join(", ", unknown)}.");
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
        var equal = (rules?["Equaling"] ?? rules?["Names"])?.Values<string>()
            .Select(CanonicalParameterName).ToList() ?? [];
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
            if (legacy.Spec == SpecTypeId.Number)
                return spec == SpecTypeId.Number ? NormalizeLegacyLiteral(name, value)
                    : throw new InvalidOperationException($"Legacy Number literal '{name}' cannot target {spec.TypeId}.");
            var legacyUnits = new Units(UnitSystem.Imperial);
            legacyUnits.SetFormatOptions(legacy.Spec, new FormatOptions(legacy.Unit));
            if (!UnitFormatUtils.TryParse(legacyUnits, legacy.Spec, value, out var legacyRaw)) {
                var normalized = NormalizeLegacyLiteral(name, value);
                if (!UnitFormatUtils.TryParse(legacyUnits, legacy.Spec, normalized, out legacyRaw))
                    throw new InvalidOperationException($"Legacy literal cannot resolve as {legacy.Spec.TypeId} in {legacy.Unit.TypeId}: {name}={value}");
            }
            if (spec == SpecTypeId.Number)
                return UnitUtils.ConvertFromInternalUnits(legacyRaw, legacy.Unit).ToString("R", System.Globalization.CultureInfo.InvariantCulture);
            return ParameterPortableFormat.ForSpec(spec)(legacyRaw);
        }
        if (spec == SpecTypeId.Number || spec == SpecTypeId.Int.Integer || !UnitUtils.IsMeasurableSpec(spec)) return value;
        if (!ParameterStringIo.TryParseMeasuredValue(units, spec, value, out var raw)) throw new InvalidOperationException($"Legacy literal cannot resolve in source units: {name}={value}");
        return ParameterPortableFormat.ForSpec(spec)(raw);
    }

    private static ElectricalConnectorParameterRule? ElectricalConnectorRule(JToken? operation) {
        if (operation is null or { Type: JTokenType.Null }) return null;
        if (operation is not JObject settings) throw new InvalidOperationException("MakeElectricalConnector must be an object.");
        RejectUnknown(settings, "MakeElectricalConnector", "Enabled", "SourceParameterNames");
        if (settings["SourceParameterNames"] is JObject declaredSources)
            RejectUnknown(declaredSources, "MakeElectricalConnector.SourceParameterNames", "Voltage", "NumberOfPoles", "ApparentPower", "MinimumCircuitAmpacity");
        else if (settings["SourceParameterNames"] is not null)
            throw new InvalidOperationException("MakeElectricalConnector.SourceParameterNames must be an object.");
        if (settings.Value<bool?>("Enabled") == false) return null;
        if (settings["SourceParameterNames"] is not JObject sources)
            throw new InvalidOperationException("MakeElectricalConnector requires SourceParameterNames.");
        string Required(string field) => string.IsNullOrWhiteSpace((string?)sources[field])
            ? throw new InvalidOperationException($"MakeElectricalConnector.SourceParameterNames.{field} is required.")
            : (string)sources[field]!;
        return new ElectricalConnectorParameterRule {
            Voltage = Required("Voltage"), NumberOfPoles = Required("NumberOfPoles"), ApparentPower = Required("ApparentPower"),
            MinimumCircuitAmpacity = Required("MinimumCircuitAmpacity")
        };
    }

    private static void RejectUnknown(JObject value, string path, params string[] allowed) {
        var unknown = value.Properties().Select(property => property.Name).Except(allowed, StringComparer.Ordinal).ToList();
        if (unknown.Count > 0) throw new InvalidOperationException($"{path} has unknown field(s): {string.Join(", ", unknown)}.");
    }

    private static string NormalizeLegacyLiteral(string name, string value) {
        var pattern = name switch {
            "PE_G___Weight" => @"^(?<value>[0-9]+(?:\.[0-9]+)?) lbs$",
            "PE_G___SoundLevel" => @"^(?<value>[0-9]+(?:\.[0-9]+)?) sones$",
            "PE_M_Fan_ExternalStaticPressure" => "^(?<value>[0-9]+(?:\\.[0-9]+)?)\\\"(?: w\\.g\\.)?$",
            _ => throw new InvalidOperationException($"No legacy literal grammar is registered for '{name}'.")
        };
        var match = System.Text.RegularExpressions.Regex.Match(value, pattern,
            System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        if (!match.Success)
            throw new InvalidOperationException($"Legacy literal does not match the known alias grammar: {name}={value}");
        return match.Groups["value"].Value;
    }

    private static string CanonicalParameterName(string name) =>
        LegacyParameterNames.TryGetValue(name, out var canonical) ? canonical : name;

    public static FamilyPatch ExportSharedMappings(MapParamsSettings settings,
        IEnumerable<ParametersApi.Parameters.ParametersResult> selectedDefinitions, bool fillBlanksFromSources = false,
        CleanFamilyDocumentSettings? clean = null, SortParamsSettings? sort = null,
        ElectricalConnectorParameterRule? electricalConnectorParameters = null) {
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
                if (mapping.SourceValuesTreatedAsMissing.Count > 0)
                    parameter["sourceValuesTreatedAsMissing"] = new JArray(mapping.SourceValuesTreatedAsMissing);
            }
            if (mapping?.OnlyAddIfSourceExists == true)
                conditional[name] = parameter.ToObject<FamilyModelParameter>(JsonSerializer.Create(FamilyModelJson.Settings))!;
            else explicitParameters[name] = parameter;
        }
        return new FamilyPatch {
            Patch = new JObject { ["parameters"] = explicitParameters },
            Run = conditional.Count == 0 && clean is null && sort is null && electricalConnectorParameters is null ? null : new PatchRun {
                ParametersIfSourceExists = conditional.Count == 0 ? null : conditional,
                ElectricalConnectorParameters = electricalConnectorParameters,
                Clean = clean, Sort = sort
            }
        };
    }
}

public sealed record FamilyProfileConversion(FamilyPatch Patch, ExecutionOptions Options);
