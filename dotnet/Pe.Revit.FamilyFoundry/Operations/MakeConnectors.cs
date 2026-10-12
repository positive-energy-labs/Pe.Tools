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
                var center = FamilyRefs.Intersect(plane, AtPlane(doc, spec.At[0]), AtPlane(doc, spec.At[1]));
                var connector = spec.Domain switch {
                    ConnectorDomain.Duct => ConnectorElement.CreateDuctConnector(doc, Revit<ConnectorSystemType, DuctSystemType>(spec.SystemType),
                        spec.Shape == ConnectorShape.Rectangular ? ConnectorProfileType.Rectangular : spec.Shape == ConnectorShape.Oval ? ConnectorProfileType.Oval : ConnectorProfileType.Round, reference),
                    ConnectorDomain.Pipe => ConnectorElement.CreatePipeConnector(doc, Revit<ConnectorSystemType, PipeSystemType>(spec.SystemType), reference),
                    ConnectorDomain.Electrical => ConnectorElement.CreateElectricalConnector(doc, Revit<ConnectorSystemType, ElectricalSystemType>(spec.SystemType), reference),
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
                if (spec.FlowDirection is { } fd) _ = (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_DIRECTION_PARAM) ?? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_DIRECTION_PARAM))?.Set((int)Revit<FlowDirection, FlowDirectionType>(fd));
                if (spec.FlowConfiguration is { } fc) {
                    var (parameter, value) = spec.Domain switch {
                        ConnectorDomain.Duct => (connector.get_Parameter(BuiltInParameter.RBS_DUCT_FLOW_CONFIGURATION_PARAM),
                            (int)Revit<FlowConfiguration, DuctFlowConfigurationType>(fc)),
                        ConnectorDomain.Pipe => (connector.get_Parameter(BuiltInParameter.RBS_PIPE_FLOW_CONFIGURATION_PARAM),
                            (int)Revit<FlowConfiguration, PipeFlowConfigurationType>(fc)),
                        _ => throw new InvalidOperationException($"{spec.Domain} connectors do not support flow configuration.")
                    };
                    if (parameter?.Set(value) != true)
                        throw new InvalidOperationException($"Connector '{slug}' could not set flow configuration '{fc}'.");
                    doc.Document.Regenerate();
                }
                if (spec.LossMethod is { } lm) _ = spec.Domain == ConnectorDomain.Pipe
                    ? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FITTING_LOSS_METHOD_PARAM)?.Set((int)Revit<LossMethod, PipeLossMethodType>(lm))
                    : connector.get_Parameter(BuiltInParameter.RBS_DUCT_FITTING_LOSS_METHOD_PARAM)?.Set((int)Revit<LossMethod, DuctLossMethodType>(lm));
                if (spec.Angle is { Degrees: { } deg }) _ = connector.get_Parameter(BuiltInParameter.CONNECTOR_ANGLE)?.Set(deg * Math.PI / 180);
                foreach (var (target, source) in spec.Associate ?? []) {
                    var p = (spec.Domain == ConnectorDomain.Pipe && target == "Fixture Units"
                        ? connector.get_Parameter(BuiltInParameter.RBS_PIPE_FIXTURE_UNITS_PARAM)
                        : connector.LookupParameter(target))
                        ?? throw new InvalidOperationException($"Connector has no parameter '{target}'.");
                    FamilyRefs.Associate(doc, p, source, logs, slug);
                }
                logs.Add(new LogEntry(slug).Success($"{spec.Domain} {spec.SystemType} on {spec.On} at {spec.At[0]} × {spec.At[1]}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    /// <summary>An `at` entry's plane: the named plane, or for `midway:A|B` the plane parallel to A and B halfway between them.</summary>
    private static Plane AtPlane(FamilyDocument doc, string entry) {
        if (!ConnectorAt.TryMidway(entry, out var a, out var b)) return FamilyRefs.Resolve(doc, entry).Plane;
        var (pa, pb) = (FamilyRefs.Resolve(doc, a).Plane, FamilyRefs.Resolve(doc, b).Plane);
        var n = pa.Normal.Normalize();
        if (Math.Abs(Math.Abs(n.DotProduct(pb.Normal.Normalize())) - 1) > 1e-9)
            throw new InvalidOperationException($"'{entry}': planes '{a}' and '{b}' are not parallel.");
        return Plane.CreateByNormalAndOrigin(n, pa.Origin + n * ((pb.Origin - pa.Origin).DotProduct(n) / 2));
    }

    private static TRevit Revit<TContract, TRevit>(TContract value) where TContract : struct, Enum where TRevit : struct, Enum =>
        Enum.TryParse<TRevit>(ConnectorRevitNames.RevitName(value), out var revit) ? revit
        : throw new InvalidOperationException($"{typeof(TContract).Name}.{value} has no Revit {typeof(TRevit).Name}.");

    private static void Size(ConnectorElement connector, BuiltInParameter bip, PortableLength? length, FamilyDocument doc, string key, List<LogEntry> logs) {
        if (length is not { } l || connector.get_Parameter(bip) is not { } p) return;
        if (l.IsParameter) FamilyRefs.Associate(doc, p, l.Parameter!, logs, key);
        else _ = p.Set(l.Feet!.Value);
    }
}
