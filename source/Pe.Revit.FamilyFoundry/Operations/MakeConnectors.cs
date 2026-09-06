using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     One connector = a small stub extrusion sketched on `on`, positioned at the intersection of the two
///     `at` planes, plus a `ConnectorElement` on the stub's terminal face, sized, configured, and associated.
///     The stub is what makes the connector addressable by name on re-read: its sketch plane IS the `on` name.
/// </summary>
public sealed class MakeConnectors((string Slug, FamilyModelConnector Spec)[] connectors, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private const double StubSize = 1.0 / 12.0;

    public override string Description => $"Create {connectors.Length} connectors: {string.Join(", ", connectors.Select(c => c.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (slug, spec) in connectors) {
            try {
                var sketchPlane = FamilyRefs.SketchPlaneFor(doc, spec.On);
                var plane = sketchPlane.GetPlane();
                var normal = plane.Normal.Normalize();
                var center = FamilyRefs.Intersect(plane, FamilyRefs.Resolve(doc, spec.At[0]).Plane, FamilyRefs.Resolve(doc, spec.At[1]).Plane);
                var half = spec.Shape == ConnectorShape.Round || spec.Diameter is not null
                    ? FamilyRefs.Feet(doc, spec.Diameter ?? PortableLength.FromFeet(StubSize)) / 2
                    : Math.Max(spec.Width is { } w ? FamilyRefs.Feet(doc, w) : StubSize, spec.Height is { } h ? FamilyRefs.Feet(doc, h) : StubSize) / 2;
                var seed = Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ;
                var x = seed.CrossProduct(normal).Normalize();
                var y = normal.CrossProduct(x).Normalize();
                var loop = new CurveArray();
                foreach (var (a, b) in new[] { (center - (x * half) - (y * half), center + (x * half) - (y * half)), (center + (x * half) - (y * half), center + (x * half) + (y * half)),
                             (center + (x * half) + (y * half), center - (x * half) + (y * half)), (center - (x * half) + (y * half), center - (x * half) - (y * half)) })
                    loop.Append(Line.CreateBound(a, b));
                var profile = new CurveArrArray();
                profile.Append(loop);
                var stub = doc.Document.FamilyCreate.NewExtrusion(true, profile, sketchPlane, StubSize);
                _ = stub.get_Parameter(BuiltInParameter.ELEMENT_IS_CUTTING)?.Set(0);
                doc.Document.Regenerate();
                var face = MakeForms.FaceOn(doc, stub, Plane.CreateByNormalAndOrigin(normal, center + (normal * StubSize)))
                           ?? throw new InvalidOperationException("Stub has no terminal face.");

                var connector = spec.Domain switch {
                    ConnectorDomain.Duct => ConnectorElement.CreateDuctConnector(doc, Enum.Parse<DuctSystemType>(spec.SystemType.ToString()),
                        spec.Shape == ConnectorShape.Rectangular ? ConnectorProfileType.Rectangular : spec.Shape == ConnectorShape.Oval ? ConnectorProfileType.Oval : ConnectorProfileType.Round, face.Reference),
                    ConnectorDomain.Pipe => ConnectorElement.CreatePipeConnector(doc, Enum.Parse<PipeSystemType>(spec.SystemType.ToString()), face.Reference),
                    ConnectorDomain.Electrical => ConnectorElement.CreateElectricalConnector(doc, Enum.Parse<ElectricalSystemType>(spec.SystemType.ToString()), face.Reference),
                    ConnectorDomain.CableTray => ConnectorElement.CreateCableTrayConnector(doc, face.Reference),
                    _ => ConnectorElement.CreateConduitConnector(doc, face.Reference)
                };
                doc.Document.Regenerate();

                Size(connector, BuiltInParameter.CONNECTOR_DIAMETER, spec.Diameter, doc, slug, logs);
                Size(connector, BuiltInParameter.CONNECTOR_WIDTH, spec.Width, doc, slug, logs);
                Size(connector, BuiltInParameter.CONNECTOR_HEIGHT, spec.Height, doc, slug, logs);
                if (spec.FlowDirection is { } fd) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM))?.Set((int)Enum.Parse<FlowDirectionType>(fd.ToString()));
                if (spec.FlowConfiguration is { } fc) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM))?.Set((int)Enum.Parse<DuctFlowConfigurationType>(fc.ToString()));
                if (spec.LossMethod is { } lm) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FITTING_LOSS_METHOD_PARAM))?.Set((int)Enum.Parse<DuctLossMethodType>(lm.ToString()));
                if (spec.Angle is { Degrees: { } deg }) _ = connector.get_Parameter(BuiltInParameter.CONNECTOR_ANGLE)?.Set(deg * Math.PI / 180);
                foreach (var (target, source) in spec.Associate ?? []) {
                    var p = connector.LookupParameter(target) ?? throw new InvalidOperationException($"Connector has no parameter '{target}'.");
                    FamilyRefs.Associate(doc, p, source, logs, slug);
                }
                logs.Add(new LogEntry(slug).Success($"{spec.Domain} {spec.SystemType} on {spec.On} at {spec.At[0]} × {spec.At[1]}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    private static void Size(ConnectorElement connector, BuiltInParameter bip, PortableLength? length, FamilyDocument doc, string key, List<LogEntry> logs) {
        if (length is not { } l || connector.get_Parameter(bip) is not { } p) return;
        if (l.IsParameter) FamilyRefs.Associate(doc, p, l.Parameter!, logs, key);
        else _ = p.Set(l.Feet!.Value);
    }
}
