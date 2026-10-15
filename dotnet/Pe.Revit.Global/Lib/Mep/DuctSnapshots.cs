using Autodesk.Revit.DB.ExtensibleStorage;
using Autodesk.Revit.DB.ExternalService;
using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
using System.Globalization;
using DuctShape = Pe.Shared.RevitData.Ducts.DuctShape;

namespace Pe.Revit.Global.Lib.Mep;

/// <summary>
///     The Revit half of `ducts.snapshot`: collects every duct, flex duct, fitting, accessory, terminal and
///     HVAC-connected equipment with its physical HVAC connectors, converts units, and hands the graph to
///     <see cref="DuctNetwork" />. Read-only: opens no transaction.
/// </summary>
public static class DuctSnapshots {
    // Revit's shipped DuctType/FlexDuctType roughness (galvanized steel). On flex it is wrong by ~10x.
    private const double RevitDefaultRoughnessFt = 0.0003;

    // Duct fitting and accessory loss servers (RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM values).
    private static readonly IReadOnlyDictionary<Guid, DuctLossMethod> LossServers = new Dictionary<Guid, DuctLossMethod> {
        [new Guid("76eff5da-2e71-45f7-b940-cc5716328ba0")] = DuctLossMethod.NotDefined,
        [new Guid("8baf7d75-8b9b-46d0-b8ce-3ad1c19e6b19")] = DuctLossMethod.AshraeTable,
        [new Guid("5a598293-1504-46cc-a9c0-de55c82848b9")] = DuctLossMethod.SpecificCoefficient,
        [new Guid("46245996-eebb-4536-ac17-9c1cd917d8cf")] = DuctLossMethod.SpecificLoss,
        [PeLossServer.Id] = DuctLossMethod.PeServer
    };

    public static DuctSnapshotData Snapshot(Document doc, DuctParameterSlots? slots = null) {
        // The names the person staged win, then the names the last apply recorded in the store, then the defaults.
        var (store, storeError) = DuctApplier.ReadStore(doc);
        slots = (slots?.Over(store?.Slots) ?? store?.Slots ?? new DuctParameterSlots()).WithDefaults();
        var clock = Stopwatch.StartNew();
        var readAt = DateTimeOffset.UtcNow;
        List<Element> Of(BuiltInCategory category) => new FilteredElementCollector(doc)
            .OfCategory(category).WhereElementIsNotElementType().ToElements().ToList();

        var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .OrderBy(l => l.ProjectElevation)
            .Select(l => new DuctLevel(l.Id.Value(), l.Name, R(l.ProjectElevation)))
            .ToList();

        // FOOTGUN (pdrop-w3, 2026-10-04): under network-based calculations Revit 2025's Connector.Flow getter can raise an
        // AccessViolationException on Project A (uncatchable in .NET 8; it killed Revit mid-snapshot). Read it only on the legacy engine.
#if REVIT2023
        // Duct network-based calculations were introduced in Revit 2024.
        // https://help.autodesk.com/cloudhelp/2024/ENU/Revit-WhatsNew/files/GUID-DB2E2193-D0FE-46EC-B721-2CE6910DBE96.htm
        const bool network = false;
#else
        var network = DuctSettings.GetDuctSettings(doc).NetworkBasedCalculations;
#endif
        var segments = Of(BuiltInCategory.OST_DuctCurves).Concat(Of(BuiltInCategory.OST_FlexDuctCurves))
            .OfType<MEPCurve>().Select(c => Segment(doc, c, network)).ToList();
        var schemas = LossSchemas();
        var nodes = new List<DuctNode>();
        nodes.AddRange(Of(BuiltInCategory.OST_DuctFitting).Select(e => Node(e, Fitting(e), slots, schemas, network)));
        nodes.AddRange(Of(BuiltInCategory.OST_DuctAccessory).Select(e => Node(e, DuctNodeKind.Accessory, slots, schemas, network)));
        nodes.AddRange(Of(BuiltInCategory.OST_DuctTerminal).Select(e => Node(e, DuctNodeKind.Terminal, slots, schemas, network)));
        nodes.AddRange(Of(BuiltInCategory.OST_MechanicalEquipment)
            .Where(e => HvacConnectors(e).Any()).Select(e => Node(e, DuctNodeKind.Equipment, slots, schemas, network)));
        var systems = new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystem)).Cast<MechanicalSystem>()
            .Where(m => m.SystemType is DuctSystemType.SupplyAir or DuctSystemType.ReturnAir or DuctSystemType.ExhaustAir)
            .OrderBy(m => m.Name, StringComparer.Ordinal)
            .Select(RevitSystem)
            .ToList();

        var analysis = DuctNetwork.Analyze(nodes, segments);
        return new DuctSnapshotData(
            new DuctDocument(doc.Title, readAt, clock.ElapsedMilliseconds, network),
            levels,
            analysis.Groups,
            analysis.Nodes,
            analysis.Segments,
            analysis.Flows,
            analysis.Issues,
            Layers(analysis, systems, slots),
            systems,
            slots,
            store,
            storeError);
    }

    internal static DuctSystem RevitSystem(MechanicalSystem m) {
        var critical = Try(() => m.GetCriticalPathSectionNumbers()?.ToList()) ?? [];
        var count = Try(() => (int?)m.SectionsCount) ?? 0;
        var sections = new List<DuctSection>();
        // Section numbers are sparse: the campaign's system had 16 sections and a critical path through 29 and 30.
        var last = Math.Max(critical.DefaultIfEmpty(0).Max(), count * 4);
        for (var k = 1; k <= last && sections.Count < count; k++)
            if (Try(() => m.GetSectionByNumber(k)) is { } section)
                sections.Add(new DuctSection(
                    k,
                    Try(() => (double?)R(UnitUtils.ConvertFromInternalUnits(section.Flow, UnitTypeId.CubicFeetPerMinute), 1)),
                    Try(() => (double?)R(UnitUtils.ConvertFromInternalUnits(section.TotalPressureLoss, UnitTypeId.InchesOfWater60DegreesFahrenheit), 5)),
                    section.GetElementIds().Select(id => id.Value()).ToList()));
        return new DuctSystem(
            m.Id.Value(),
            m.Name,
            m.SystemType.ToString(),
            Try(() => (bool?)m.IsWellConnected),
            Try(() => m.BaseEquipment?.Id.Value()),
            Try(() => m.BaseEquipmentConnector?.Id),
            Try(() => (double?)R(UnitUtils.ConvertFromInternalUnits(m.PressureLossOfCriticalPath, UnitTypeId.InchesOfWater60DegreesFahrenheit), 5)),
            critical,
            sections);
    }

    private static Dictionary<Guid, Schema?> LossSchemas() {
        var service = ExternalServiceRegistry.GetService(ExternalServices.BuiltInExternalServices.DuctFittingAndAccessoryPressureDropService);
        return LossServers.Keys.ToDictionary(id => id,
            id => Try(() => (service?.GetServer(id) as IDuctFittingAndAccessoryPressureDropServer)?.GetDataSchema()));
    }

    private static DuctLoss Loss(Element e, Dictionary<Guid, Schema?> schemas) {
        var server = e.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM)?.AsString();
        var known = Guid.TryParse(server, out var id) && LossServers.ContainsKey(id);
        var fields = new SortedDictionary<string, string>(StringComparer.Ordinal);
        if (known && schemas[id] is { } schema && schema.ReadAccessGranted() && e.GetEntity(schema) is { } entity && entity.IsValid())
            foreach (var field in schema.ListFields().Where(f => f.ValueType == typeof(string)))
                if (entity.Get<string>(field) is { Length: > 0 } value) fields[field.FieldName] = value;
        double? Number(Func<string, bool> name) =>
            fields.FirstOrDefault(kv => name(kv.Key)).Value is { } text
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var v) ? v : null;
        var method = known ? LossServers[id] : DuctLossMethod.Other;
        // The Specific Loss entity's one field is PressureLoss, a string in Revit internal pressure units (pressure-drop ledger, W3).
        var specificLoss = method == DuctLossMethod.SpecificLoss
            && Number(k => k != "Coefficient" && (k.Contains("Loss") || k.Contains("Pressure"))) is { } raw
                ? R(UnitUtils.ConvertFromInternalUnits(raw, UnitTypeId.InchesOfWater60DegreesFahrenheit), 5)
                : (double?)null;
        return new DuctLoss(
            method,
            server is { Length: > 0 } ? server : null,
            fields.TryGetValue("ASHRAETableName", out var table) && table.Length > 0 ? table : null,
            method == DuctLossMethod.SpecificCoefficient ? Number(k => k == "Coefficient") : null,
            specificLoss,
            // RBS_PRESSURE_DROP is empty on a fitting charged through a stored ASHRAE table; RBS_DUCT_PRESSURE_DROP is the Properties palette value (pressure-drop ledger, 2026-10-05).
            Converted(e, BuiltInParameter.RBS_DUCT_PRESSURE_DROP, UnitTypeId.InchesOfWater60DegreesFahrenheit),
            fields);
    }

    private static DuctTerminalDrop Terminal(Element e, DuctParameterSlots slots) {
        var c = HvacConnectors(e).FirstOrDefault();
        var method = c is null ? null : Try(() => c.AssignedDuctLossMethod.ToString());
        return new DuctTerminalDrop(
            c is null ? null : Try(() => (double?)R(UnitUtils.ConvertFromInternalUnits(c.AssignedPressureDrop, UnitTypeId.InchesOfWater60DegreesFahrenheit), 5)),
            method,
            method == nameof(DuctLossMethodType.SpecificLoss),
            slots.TerminalDrop is { } name ? Converted(Named(e, name), UnitTypeId.InchesOfWater60DegreesFahrenheit) : null);
    }

    private static DuctSegment Segment(Document doc, MEPCurve curve, bool network) {
        var flex = curve is FlexDuct;
        var type = doc.GetElement(curve.GetTypeId()) as MEPCurveType;
        var roughness = type?.Roughness ?? 0;
        var connectors = HvacConnectors(curve).Select(c => Connector(c, network)).ToList();
        var polyline = curve is FlexDuct fd
            ? fd.Points.Select(P).ToList()
            : curve.Location is LocationCurve { Curve: var line }
                ? new List<double[]> { P(line.GetEndPoint(0)), P(line.GetEndPoint(1)) }
                : [];
        return new DuctSegment(
            curve.Id.Value(),
            flex ? DuctSegmentKind.Flex : DuctSegmentKind.Duct,
            type?.Name,
            connectors.FirstOrDefault(c => c.Kind == "end")?.Shape ?? DuctShape.Other,
            Text(curve, BuiltInParameter.RBS_CALCULATED_SIZE) ?? "",
            Inches(curve, BuiltInParameter.RBS_CURVE_DIAMETER_PARAM),
            Inches(curve, BuiltInParameter.RBS_CURVE_WIDTH_PARAM),
            Inches(curve, BuiltInParameter.RBS_CURVE_HEIGHT_PARAM),
            R(curve.get_Parameter(BuiltInParameter.CURVE_ELEM_LENGTH)?.AsDouble() ?? 0),
            polyline,
            curve.ReferenceLevel?.Id.Value(),
            null,
            Text(curve, BuiltInParameter.RBS_SYSTEM_NAME_PARAM),
            Text(curve, BuiltInParameter.RBS_SYSTEM_CLASSIFICATION_PARAM),
            new DuctRoughness(roughness,
                Math.Abs(roughness - RevitDefaultRoughnessFt) < 1e-9 ? DuctProvenance.RevitDefault : DuctProvenance.DesignerStated),
            new DuctRevitValues(
                Converted(curve, BuiltInParameter.RBS_DUCT_FLOW_PARAM, UnitTypeId.CubicFeetPerMinute),
                Converted(curve, BuiltInParameter.RBS_VELOCITY, UnitTypeId.FeetPerMinute),
                Converted(curve, BuiltInParameter.RBS_FRICTION, UnitTypeId.InchesOfWater60DegreesFahrenheitPer100Feet),
                Converted(curve, BuiltInParameter.RBS_PRESSURE_DROP, UnitTypeId.InchesOfWater60DegreesFahrenheit)),
            connectors);
    }

    private static DuctNodeKind Fitting(Element e) =>
        (e as FamilyInstance)?.MEPModel is MechanicalFitting { PartType: PartType.Cap } ? DuctNodeKind.Cap : DuctNodeKind.Fitting;

    private static DuctNode Node(Element e, DuctNodeKind kind, DuctParameterSlots slots, Dictionary<Guid, Schema?> schemas, bool network) {
        var fi = e as FamilyInstance;
        var facts = new List<DuctFact>();
        switch (kind) {
            case DuctNodeKind.Terminal:
                facts.Add(Fact(DuctNetwork.TerminalFlow, Converted(e, BuiltInParameter.RBS_DUCT_FLOW_PARAM, UnitTypeId.CubicFeetPerMinute), "cfm", DuctProvenance.DesignerStated));
                if (Space(fi) is { } space) facts.Add(new DuctFact("space", null, space, "", DuctProvenance.Geometry));
                break;
            case DuctNodeKind.Accessory:
                facts.Add(Fact(DuctNetwork.PressureDrop, Converted(Named(e, slots.ComponentDrop), UnitTypeId.InchesOfWater60DegreesFahrenheit), "in-wg", DuctProvenance.DesignerStated));
                break;
            case DuctNodeKind.Equipment:
                facts.Add(Fact(DuctNetwork.ExternalStatic, Converted(Named(e, slots.FanStatic), UnitTypeId.InchesOfWater60DegreesFahrenheit), "in-wg", DuctProvenance.DesignerStated));
                facts.Add(Fact("fanFlow", Converted(Named(e, slots.FanFlow), UnitTypeId.CubicFeetPerMinute), "cfm", DuctProvenance.DesignerStated));
                break;
            case DuctNodeKind.Fitting:
                if (DuctFittingGeometry.Angle(e) is { } angle) facts.Add(angle);
                // Revit's elbow families carry "Center Radius" as an instance length; r/D is derived in DuctNetwork.
                if (e.LookupParameter("Center Radius") is { HasValue: true, StorageType: StorageType.Double } radius && radius.AsDouble() > 0)
                    facts.Add(new DuctFact(DuctNetwork.CenterRadius, R(radius.AsDouble() * 12), null, "in", DuctProvenance.Geometry));
                // The family's own coefficient (a lookup-table formula, -1 when its table has no row): what the Pe loss server charges.
                if (e.LookupParameter(slots.FittingCoefficient) is { HasValue: true, StorageType: StorageType.Double } own)
                    facts.Add(new DuctFact(DuctNetwork.FamilyCoefficient, R(own.AsDouble(), 4), null, "", DuctProvenance.RevitReported));
                break;
        }
        var levelId = e.LevelId != ElementId.InvalidElementId
            ? e.LevelId
            : e.get_Parameter(BuiltInParameter.FAMILY_LEVEL_PARAM)?.AsElementId();
        return new DuctNode(
            e.Id.Value(),
            kind,
            e.Category?.Name ?? "",
            fi?.Symbol?.FamilyName,
            fi?.Symbol?.Name,
            (fi?.MEPModel as MechanicalFitting)?.PartType.ToString(),
            levelId is { } id && id != ElementId.InvalidElementId ? id.Value() : null,
            Where(e),
            null,
            Text(e, BuiltInParameter.RBS_SYSTEM_NAME_PARAM),
            Text(e, BuiltInParameter.RBS_SYSTEM_CLASSIFICATION_PARAM),
            HvacConnectors(e).Select(c => Connector(c, network)).ToList(),
            facts.Where(f => f.Value is not null || f.Text is not null).ToList(),
            kind is DuctNodeKind.Fitting or DuctNodeKind.Accessory ? Loss(e, schemas) : null,
            kind == DuctNodeKind.Terminal ? Terminal(e, slots) : null);
    }

    private static IReadOnlyList<DuctLayer> Layers(DuctNetwork.Analysis a, IReadOnlyList<DuctSystem> systems, DuctParameterSlots slots) {
        var segs = a.Segments;
        var terminals = a.Nodes.Where(n => n.Kind == DuctNodeKind.Terminal).ToList();
        var equipment = a.Nodes.Where(n => n.Kind == DuctNodeKind.Equipment).ToList();
        var accessories = a.Nodes.Where(n => n.Kind == DuctNodeKind.Accessory).ToList();
        var ports = a.Nodes.Where(n => n.Kind != DuctNodeKind.Equipment).SelectMany(n => n.Connectors)
            .Concat(segs.SelectMany(s => s.Connectors)).ToList();
        var elements = a.Nodes.Count + segs.Count;
        var issueGroups = a.Issues.Select(i => i.GroupId).ToHashSet();
        var fittings = a.Nodes.Where(n => n.Kind == DuctNodeKind.Fitting).ToList();
        var lossy = a.Nodes.Where(n => n.Loss is not null).ToList();
        return [
            new("topology", "Topology from connector walks",
                "FilteredElementCollector(doc).OfCategory(OST_DuctCurves | OST_FlexDuctCurves | OST_DuctFitting | OST_DuctAccessory | OST_DuctTerminal | OST_MechanicalEquipment).WhereElementIsNotElementType(); each ConnectorManager.Connectors where Domain == DomainHvac and ConnectorType is End or Curve; Connector.AllRefs names the connected owner. Equipment is cut out: its ports become group roots.",
                new(ports.Count(c => c.ConnectedTo is not null), ports.Count), DuctProvenance.Geometry),
            new("sizes", "Sizes and lengths",
                "Duct and FlexDuct: RBS_CALCULATED_SIZE, RBS_CURVE_DIAMETER_PARAM, RBS_CURVE_WIDTH_PARAM, RBS_CURVE_HEIGHT_PARAM, CURVE_ELEM_LENGTH; LocationCurve end points, FlexDuct.Points",
                new(segs.Count(s => s.DiameterIn is not null || s.WidthIn is not null), segs.Count), DuctProvenance.Geometry),
            new("revit-flow", "Revit flow and velocity",
                "Duct and FlexDuct: RBS_DUCT_FLOW_PARAM (CubicFeetPerMinute), RBS_VELOCITY (FeetPerMinute)",
                new(segs.Count(s => s.Revit.FlowCfm is not null), segs.Count), DuctProvenance.RevitReported),
            new("revit-pressure", "Revit pressure drop and friction",
                "Duct and FlexDuct: RBS_PRESSURE_DROP (InchesOfWater60DegreesFahrenheit), RBS_FRICTION (InchesOfWater60DegreesFahrenheitPer100Feet)",
                new(segs.Count(s => s.Revit.PressureDropInWg is not null), segs.Count), DuctProvenance.RevitReported),
            new("roughness", "Roughness",
                $"MEPCurveType.Roughness of each DuctType and FlexDuctType; {RevitDefaultRoughnessFt} ft is the Revit default",
                new(segs.Count(s => s.Roughness.Provenance != DuctProvenance.RevitDefault), segs.Count), DuctProvenance.RevitDefault),
            new("terminal-flow", "Terminal design flow",
                "OST_DuctTerminal instances: RBS_DUCT_FLOW_PARAM (CubicFeetPerMinute)",
                new(terminals.Count(t => DuctNetwork.Fact(t, DuctNetwork.TerminalFlow) > 0), terminals.Count), DuctProvenance.DesignerStated),
            new("pass1-flow", "Derived flow (pass 1)",
                "DuctNetwork.PassOne: terminal design flow summed up the tree from the one equipment port of each loop-free group",
                new(a.Flows.Count, segs.Count), DuctProvenance.Derived),
            new("fan-static", "Fan external static",
                $"OST_MechanicalEquipment with HVAC connectors: LookupParameter(\"{slots.FanStatic}\") (InchesOfWater60DegreesFahrenheit) and LookupParameter(\"{slots.FanFlow}\") on the instance, else on its FamilySymbol",
                new(equipment.Count(e => DuctNetwork.Fact(e, DuctNetwork.ExternalStatic) > 0), equipment.Count), DuctProvenance.DesignerStated),
            new("component-drop", "Component pressure drop",
                $"OST_DuctAccessory instances: LookupParameter(\"{slots.ComponentDrop}\") (InchesOfWater60DegreesFahrenheit) on the instance, else on its FamilySymbol",
                new(accessories.Count(e => DuctNetwork.Fact(e, DuctNetwork.PressureDrop) > 0), accessories.Count), DuctProvenance.DesignerStated),
            new("systems", "Systems and labels",
                "every element: RBS_SYSTEM_NAME_PARAM, RBS_SYSTEM_CLASSIFICATION_PARAM",
                new(a.Nodes.Count(n => n.SystemName is not null) + segs.Count(s => s.SystemName is not null), elements), DuctProvenance.RevitReported),
            new("spaces", "Terminal spaces",
                "OST_DuctTerminal instances: FamilyInstance.Space (Number Name)",
                new(terminals.Count(t => t.Facts.Any(f => f.Key == "space")), terminals.Count), DuctProvenance.Geometry),
            new("fitting-geometry", "Fitting geometry",
                $"OST_DuctFitting: instance-to-symbol Angle parameter (Angle spec, exact origin retained), LookupParameter(\"Center Radius\"), LookupParameter(\"{slots.FittingCoefficient}\") (familyCoefficient); connector sizes; DuctNetwork derives rOverD (round elbows), inlet and aoOverA1 (explicit physical In/Out transitions), takeoff, mainDiameter, mainArea and abOverAc (fittings on a duct's curve connector)",
                new(fittings.Count(n => n.Facts.Any(f => f.Key is DuctNetwork.ROverD or DuctNetwork.AoOverA1 or DuctNetwork.AbOverAc)), fittings.Count), DuctProvenance.Geometry),
            new("loss-method", "Fitting and accessory loss method",
                "RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM; ExternalServiceRegistry DuctFittingAndAccessoryPressureDropService GetServer(id).GetDataSchema(), Element.GetEntity(schema) string fields (ASHRAETableName, Coefficient); RBS_DUCT_PRESSURE_DROP",
                new(lossy.Count(n => n.Loss!.Method is DuctLossMethod.SpecificCoefficient or DuctLossMethod.SpecificLoss), lossy.Count), DuctProvenance.RevitReported),
            new("terminal-drop", "Terminal pressure drop",
                "OST_DuctTerminal first HVAC connector: AssignedPressureDrop (InchesOfWater60DegreesFahrenheit), AssignedDuctLossMethod (writable only under SpecificLoss); "
                + (slots.TerminalDrop is { } td ? $"catalog LookupParameter(\"{td}\") on the instance, else on its FamilySymbol" : "no catalog drop slot named"),
                new(terminals.Count(t => t.TerminalDrop?.AssignedPressureDropInWg > 0 || t.TerminalDrop?.CatalogDropInWg > 0), terminals.Count), DuctProvenance.DesignerStated),
            new("revit-systems", "Revit systems and critical path",
                "FilteredElementCollector(doc).OfClass(MechanicalSystem) where SystemType is SupplyAir, ReturnAir or ExhaustAir: IsWellConnected, BaseEquipment, BaseEquipmentConnector, PressureLossOfCriticalPath, GetCriticalPathSectionNumbers(), GetSectionByNumber(k) Flow, TotalPressureLoss, GetElementIds(); DuctSettings.NetworkBasedCalculations",
                new(systems.Count(s => s.CriticalPath.Count > 0), systems.Count), DuctProvenance.RevitReported),
            new("issues", "Issues",
                "DuctNetwork.Analyze over the topology layer: open ends (caps excluded), loops, stubs under 3 in, implausible sizes, default flex roughness, roots, missing terminal flow, fan static and component drops, and Revit velocity of 2000 fpm or more",
                new(a.Groups.Count(g => !issueGroups.Contains(g.Id)), a.Groups.Count), DuctProvenance.Derived)
        ];
    }

    internal static IEnumerable<Connector> HvacConnectors(Element e) {
        var manager = e switch {
            MEPCurve c => c.ConnectorManager,
            FamilyInstance fi => fi.MEPModel?.ConnectorManager,
            _ => null
        };
        if (manager is null) yield break;
        foreach (Connector c in manager.Connectors)
            if (c.Domain == Domain.DomainHvac && c.ConnectorType is ConnectorType.End or ConnectorType.Curve)
                yield return c;
    }

    private static DuctConnector Connector(Connector c, bool network) {
        var shape = c.Shape switch {
            ConnectorProfileType.Round => DuctShape.Round,
            ConnectorProfileType.Rectangular => DuctShape.Rectangular,
            ConnectorProfileType.Oval => DuctShape.Oval,
            _ => DuctShape.Other
        };
        double? diameter = shape == DuctShape.Round ? R(c.Radius * 24) : null;
        double? width = shape is DuctShape.Rectangular or DuctShape.Oval ? R(c.Width * 12) : null;
        double? height = shape is DuctShape.Rectangular or DuctShape.Oval ? R(c.Height * 12) : null;
        return new DuctConnector(
            c.Id,
            c.ConnectorType == ConnectorType.Curve ? "curve" : "end",
            P(c.Origin),
            shape,
            diameter is { } d ? $"{d:0.#}\"ÃƒÂ¸" : width is { } w && height is { } h ? $"{w:0.#}x{h:0.#}" : "",
            diameter,
            width,
            height,
            network ? null : Try(() => Math.Abs(c.Flow) > 1e-9 ? R(UnitUtils.ConvertFromInternalUnits(c.Flow, UnitTypeId.CubicFeetPerMinute)) : (double?)null),
            Try(() => c.Direction switch {
                FlowDirectionType.In => "in",
                FlowDirectionType.Out => "out",
                _ => "bidirectional"
            }) ?? "n/a",
            Try(() => c.DuctSystemType.ToString()),
            ConnectedTo(c),
            DuctNetwork.Area(shape, diameter, width, height) is { } area ? R(area, 5) : null);
    }

    private static DuctRef? ConnectedTo(Connector c) {
        if (!c.IsConnected) return null;
        foreach (Connector other in c.AllRefs)
            if (other.Owner.Id != c.Owner.Id && other.ConnectorType is ConnectorType.End or ConnectorType.Curve)
                return new DuctRef(other.Owner.Id.Value(), other.Id);
        return null;
    }

    private static string? Space(FamilyInstance? fi) =>
        Try(() => fi?.Space is { } s ? $"{s.Number} {s.Name}".Trim() : null);

    private static double[] Where(Element e) =>
        e.Location is LocationPoint lp ? P(lp.Point)
        : e.get_BoundingBox(null) is { } box ? P((box.Min + box.Max) / 2)
        : [0, 0, 0];

    // FOOTGUN: project-a states fan static on the type (Panasonic DBF-DEDPV, SunTherm MUA); an instance-only lookup reads none.
    private static Parameter? Named(Element e, string name) =>
        e.LookupParameter(name) is { HasValue: true } own ? own : (e as FamilyInstance)?.Symbol?.LookupParameter(name);

    private static DuctFact Fact(string key, double? value, string unit, DuctProvenance provenance) =>
        new(key, value, null, unit, provenance);

    private static string? Text(Element e, BuiltInParameter p) =>
        e.get_Parameter(p) is { HasValue: true } param
            ? (param.StorageType == StorageType.String ? param.AsString() : param.AsValueString()) is { Length: > 0 } s ? s : null
            : null;

    private static double? Inches(Element e, BuiltInParameter p) =>
        e.get_Parameter(p) is { HasValue: true, StorageType: StorageType.Double } param ? R(param.AsDouble() * 12) : null;

    private static double? Converted(Element e, BuiltInParameter p, ForgeTypeId unit) => Converted(e.get_Parameter(p), unit);

    private static double? Converted(Parameter? param, ForgeTypeId unit) =>
        param is { HasValue: true, StorageType: StorageType.Double } && Math.Abs(param.AsDouble()) > 1e-9
            ? R(UnitUtils.ConvertFromInternalUnits(param.AsDouble(), unit), 4)
            : null;

    private static T? Try<T>(Func<T?> read) {
        try {
            return read();
        } catch (Exception ex) when (IsRevitFailure(ex)) {
            return default;
        }
    }

    /// <summary>
    ///     A Revit API refusal. FOOTGUN (W3, R2025): an invalidated wrapper throws
    ///     Autodesk.Revit.Proxy.Exceptions.InvalidObjectExceptionProxy, which is not an Autodesk.Revit.Exceptions type.
    /// </summary>
    internal static bool IsRevitFailure(Exception ex) =>
        ex is Autodesk.Revit.Exceptions.ApplicationException or InvalidOperationException
        || ex.GetType().Namespace?.StartsWith("Autodesk.Revit", StringComparison.Ordinal) == true;

    private static double[] P(XYZ p) => [R(p.X), R(p.Y), R(p.Z)];
    private static double R(double v, int digits = 3) => Math.Round(v, digits);
}
