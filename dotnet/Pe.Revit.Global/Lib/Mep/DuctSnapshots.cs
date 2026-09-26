using Autodesk.Revit.DB.Mechanical;
using Pe.Shared.RevitData.Ducts;
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

    public static DuctSnapshotData Snapshot(Document doc) {
        var clock = Stopwatch.StartNew();
        var readAt = DateTimeOffset.UtcNow;
        List<Element> Of(BuiltInCategory category) => new FilteredElementCollector(doc)
            .OfCategory(category).WhereElementIsNotElementType().ToElements().ToList();

        var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>()
            .OrderBy(l => l.ProjectElevation)
            .Select(l => new DuctLevel(l.Id.Value, l.Name, R(l.ProjectElevation)))
            .ToList();

        var segments = Of(BuiltInCategory.OST_DuctCurves).Concat(Of(BuiltInCategory.OST_FlexDuctCurves))
            .OfType<MEPCurve>().Select(c => Segment(doc, c)).ToList();
        var nodes = new List<DuctNode>();
        nodes.AddRange(Of(BuiltInCategory.OST_DuctFitting).Select(e => Node(doc, e, Fitting(e))));
        nodes.AddRange(Of(BuiltInCategory.OST_DuctAccessory).Select(e => Node(doc, e, DuctNodeKind.Accessory)));
        nodes.AddRange(Of(BuiltInCategory.OST_DuctTerminal).Select(e => Node(doc, e, DuctNodeKind.Terminal)));
        nodes.AddRange(Of(BuiltInCategory.OST_MechanicalEquipment)
            .Where(e => Hvac(e).Any()).Select(e => Node(doc, e, DuctNodeKind.Equipment)));

        var analysis = DuctNetwork.Analyze(nodes, segments);
        return new DuctSnapshotData(
            new DuctDocument(doc.Title, readAt, clock.ElapsedMilliseconds),
            levels,
            analysis.Groups,
            analysis.Nodes,
            analysis.Segments,
            analysis.Flows,
            analysis.Issues,
            Layers(analysis));
    }

    private static DuctSegment Segment(Document doc, MEPCurve curve) {
        var flex = curve is FlexDuct;
        var type = doc.GetElement(curve.GetTypeId()) as MEPCurveType;
        var roughness = type?.Roughness ?? 0;
        var connectors = Hvac(curve).Select(Connector).ToList();
        var polyline = curve is FlexDuct fd
            ? fd.Points.Select(P).ToList()
            : curve.Location is LocationCurve { Curve: var line }
                ? new List<double[]> { P(line.GetEndPoint(0)), P(line.GetEndPoint(1)) }
                : [];
        return new DuctSegment(
            curve.Id.Value,
            flex ? DuctSegmentKind.Flex : DuctSegmentKind.Duct,
            type?.Name,
            connectors.FirstOrDefault(c => c.Kind == "end")?.Shape ?? DuctShape.Other,
            Text(curve, BuiltInParameter.RBS_CALCULATED_SIZE) ?? "",
            Inches(curve, BuiltInParameter.RBS_CURVE_DIAMETER_PARAM),
            Inches(curve, BuiltInParameter.RBS_CURVE_WIDTH_PARAM),
            Inches(curve, BuiltInParameter.RBS_CURVE_HEIGHT_PARAM),
            R(curve.get_Parameter(BuiltInParameter.CURVE_ELEM_LENGTH)?.AsDouble() ?? 0),
            polyline,
            curve.ReferenceLevel?.Id.Value,
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

    private static DuctNode Node(Document doc, Element e, DuctNodeKind kind) {
        var fi = e as FamilyInstance;
        var facts = new List<DuctFact>();
        switch (kind) {
            case DuctNodeKind.Terminal:
                facts.Add(Fact(DuctNetwork.TerminalFlow, Converted(e, BuiltInParameter.RBS_DUCT_FLOW_PARAM, UnitTypeId.CubicFeetPerMinute), "cfm", DuctProvenance.DesignerStated));
                if (Space(fi) is { } space) facts.Add(new DuctFact("space", null, space, "", DuctProvenance.Geometry));
                break;
            case DuctNodeKind.Accessory:
                facts.Add(Fact(DuctNetwork.PressureDrop, Converted(Named(e, "Pressure Drop"), UnitTypeId.InchesOfWater60DegreesFahrenheit), "in-wg", DuctProvenance.DesignerStated));
                break;
            case DuctNodeKind.Equipment:
                facts.Add(Fact(DuctNetwork.ExternalStatic, Converted(Named(e, "PE_M_Fan_ExternalStaticPressure"), UnitTypeId.InchesOfWater60DegreesFahrenheit), "in-wg", DuctProvenance.DesignerStated));
                facts.Add(Fact("fanFlow", Converted(Named(e, "PE_M_Fan_AirFlow"), UnitTypeId.CubicFeetPerMinute), "cfm", DuctProvenance.DesignerStated));
                break;
            case DuctNodeKind.Fitting when e.LookupParameter("Angle") is { HasValue: true, StorageType: StorageType.Double } angle:
                facts.Add(new DuctFact("angle", R(angle.AsDouble() * 180 / Math.PI), null, "deg", DuctProvenance.Geometry));
                break;
        }
        var levelId = e.LevelId != ElementId.InvalidElementId
            ? e.LevelId
            : e.get_Parameter(BuiltInParameter.FAMILY_LEVEL_PARAM)?.AsElementId();
        return new DuctNode(
            e.Id.Value,
            kind,
            e.Category?.Name ?? "",
            fi?.Symbol?.FamilyName,
            fi?.Symbol?.Name,
            (fi?.MEPModel as MechanicalFitting)?.PartType.ToString(),
            levelId is { } id && id != ElementId.InvalidElementId ? id.Value : null,
            Where(e),
            null,
            Text(e, BuiltInParameter.RBS_SYSTEM_NAME_PARAM),
            Text(e, BuiltInParameter.RBS_SYSTEM_CLASSIFICATION_PARAM),
            Hvac(e).Select(Connector).ToList(),
            facts.Where(f => f.Value is not null || f.Text is not null).ToList());
    }

    private static IReadOnlyList<DuctLayer> Layers(DuctNetwork.Analysis a) {
        var segs = a.Segments;
        var terminals = a.Nodes.Where(n => n.Kind == DuctNodeKind.Terminal).ToList();
        var equipment = a.Nodes.Where(n => n.Kind == DuctNodeKind.Equipment).ToList();
        var accessories = a.Nodes.Where(n => n.Kind == DuctNodeKind.Accessory).ToList();
        var ports = a.Nodes.Where(n => n.Kind != DuctNodeKind.Equipment).SelectMany(n => n.Connectors)
            .Concat(segs.SelectMany(s => s.Connectors)).ToList();
        var elements = a.Nodes.Count + segs.Count;
        var issueGroups = a.Issues.Select(i => i.GroupId).ToHashSet();
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
                "OST_MechanicalEquipment with HVAC connectors: LookupParameter(\"PE_M_Fan_ExternalStaticPressure\") (InchesOfWater60DegreesFahrenheit) and LookupParameter(\"PE_M_Fan_AirFlow\") on the instance, else on its FamilySymbol",
                new(equipment.Count(e => DuctNetwork.Fact(e, DuctNetwork.ExternalStatic) > 0), equipment.Count), DuctProvenance.DesignerStated),
            new("component-drop", "Component pressure drop",
                "OST_DuctAccessory instances: LookupParameter(\"Pressure Drop\") (InchesOfWater60DegreesFahrenheit) on the instance, else on its FamilySymbol",
                new(accessories.Count(e => DuctNetwork.Fact(e, DuctNetwork.PressureDrop) > 0), accessories.Count), DuctProvenance.DesignerStated),
            new("systems", "Systems and labels",
                "every element: RBS_SYSTEM_NAME_PARAM, RBS_SYSTEM_CLASSIFICATION_PARAM",
                new(a.Nodes.Count(n => n.SystemName is not null) + segs.Count(s => s.SystemName is not null), elements), DuctProvenance.RevitReported),
            new("spaces", "Terminal spaces",
                "OST_DuctTerminal instances: FamilyInstance.Space (Number Name)",
                new(terminals.Count(t => t.Facts.Any(f => f.Key == "space")), terminals.Count), DuctProvenance.Geometry),
            new("issues", "Issues",
                "DuctNetwork.Analyze over the topology layer: open ends (caps excluded), loops, stubs under 3 in, implausible sizes, default flex roughness, roots, missing terminal flow, fan static and component drops, and Revit velocity of 2000 fpm or more",
                new(a.Groups.Count(g => !issueGroups.Contains(g.Id)), a.Groups.Count), DuctProvenance.Derived)
        ];
    }

    private static IEnumerable<Connector> Hvac(Element e) {
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

    private static DuctConnector Connector(Connector c) {
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
            diameter is { } d ? $"{d:0.#}\"ø" : width is { } w && height is { } h ? $"{w:0.#}x{h:0.#}" : "",
            diameter,
            width,
            height,
            Try(() => Math.Abs(c.Flow) > 1e-9 ? R(UnitUtils.ConvertFromInternalUnits(c.Flow, UnitTypeId.CubicFeetPerMinute)) : (double?)null),
            Try(() => c.Direction switch {
                FlowDirectionType.In => "in",
                FlowDirectionType.Out => "out",
                _ => "bidirectional"
            }) ?? "n/a",
            Try(() => c.DuctSystemType.ToString()),
            ConnectedTo(c));
    }

    private static DuctRef? ConnectedTo(Connector c) {
        if (!c.IsConnected) return null;
        foreach (Connector other in c.AllRefs)
            if (other.Owner.Id != c.Owner.Id && other.ConnectorType is ConnectorType.End or ConnectorType.Curve)
                return new DuctRef(other.Owner.Id.Value, other.Id);
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
        } catch (Autodesk.Revit.Exceptions.ApplicationException) {
            return default;
        } catch (InvalidOperationException) {
            return default;
        }
    }

    private static double[] P(XYZ p) => [R(p.X), R(p.Y), R(p.Z)];
    private static double R(double v, int digits = 3) => Math.Round(v, digits);
}
