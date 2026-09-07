using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>Create native plane-hosted connectors at the intersection of the on and at planes.</summary>
public sealed class MakeConnectors((string Slug, FamilyModelConnector Spec)[] connectors, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {

    public override string Description => $"Create {connectors.Length} connectors: {string.Join(", ", connectors.Select(c => c.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (slug, spec) in connectors) {
            try {
                var (reference, plane) = FamilyRefs.Resolve(doc, spec.On);
                var normal = plane.Normal.Normalize();
                var center = FamilyRefs.Intersect(plane, FamilyRefs.Resolve(doc, spec.At[0]).Plane, FamilyRefs.Resolve(doc, spec.At[1]).Plane);
                var connector = spec.Domain switch {
                    ConnectorDomain.Duct => ConnectorElement.CreateDuctConnector(doc, (DuctSystemType)Enum.Parse(typeof(DuctSystemType), spec.SystemType.ToString()),
                        spec.Shape == ConnectorShape.Rectangular ? ConnectorProfileType.Rectangular : spec.Shape == ConnectorShape.Oval ? ConnectorProfileType.Oval : ConnectorProfileType.Round, reference),
                    ConnectorDomain.Pipe => ConnectorElement.CreatePipeConnector(doc, (PipeSystemType)Enum.Parse(typeof(PipeSystemType), spec.SystemType.ToString()), reference),
                    ConnectorDomain.Electrical => ConnectorElement.CreateElectricalConnector(doc, (ElectricalSystemType)Enum.Parse(typeof(ElectricalSystemType), spec.SystemType.ToString()), reference),
                    ConnectorDomain.CableTray => ConnectorElement.CreateCableTrayConnector(doc, reference),
                    _ => ConnectorElement.CreateConduitConnector(doc, reference)
                };
                doc.Document.Regenerate();

                ElementTransformUtils.MoveElement(doc, connector.Id, center - connector.Origin);
                if (connector.CoordinateSystem.BasisZ.DotProduct(normal) < 0) connector.FlipDirection();
                doc.Document.Regenerate();

                Size(connector, BuiltInParameter.CONNECTOR_DIAMETER, spec.Diameter, doc, slug, logs);
                Size(connector, BuiltInParameter.CONNECTOR_WIDTH, spec.Width, doc, slug, logs);
                Size(connector, BuiltInParameter.CONNECTOR_HEIGHT, spec.Height, doc, slug, logs);
                if (spec.FlowDirection is { } fd) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM))?.Set((int)(FlowDirectionType)Enum.Parse(typeof(FlowDirectionType), fd.ToString()));
                if (spec.FlowConfiguration is { } fc) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM))?.Set((int)(DuctFlowConfigurationType)Enum.Parse(typeof(DuctFlowConfigurationType), fc.ToString()));
                if (spec.LossMethod is { } lm) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FITTING_LOSS_METHOD_PARAM))?.Set((int)(DuctLossMethodType)Enum.Parse(typeof(DuctLossMethodType), lm.ToString()));
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
