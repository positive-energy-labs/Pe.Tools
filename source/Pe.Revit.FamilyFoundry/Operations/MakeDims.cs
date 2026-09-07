using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Create dimensions between N named references (planes, levels, reference lines): labeled by a parameter,
///     locked to a literal, or EQ. Harvested from RefPlaneDimCreator: view choice, reference arrays,
///     `NewLinearDimension`, `AreSegmentsEqual`, `FamilyLabel`.
/// </summary>
public sealed class MakeDims((string Slug, FamilyModelDim Spec)[] dims, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private const double Stagger = 0.5;

    public override string Description => $"Create {dims.Length} dimensions: {string.Join(", ", dims.Select(d => d.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        // Newly created planes have no usable dimension references until geometry is regenerated.
        doc.Document.Regenerate();
        var logs = new List<LogEntry>();
        var labels = new List<(Dimension, FamilyParameter)>();
        var index = 0;
        foreach (var (slug, spec) in dims) {
            try {
                var resolved = spec.Between.Select(n => Resolve(doc, n)).ToList();
                var normal = resolved[0].Plane.Normal;
                var view = FamilyRefs.ViewFor(doc, spec.View, Math.Abs(normal.Z) > 0.95 ? XYZ.BasisX : XYZ.BasisZ);
                var refs = new ReferenceArray();
                foreach (var (r, _) in resolved) refs.Append(r);
                var first = resolved[0].Plane.Origin;
                var last = resolved[^1].Plane.Origin;
                var span = normal * normal.DotProduct(last - first);
                var offsetDir = view.UpDirection.IsAlmostEqualTo(normal) || view.UpDirection.IsAlmostEqualTo(-normal) ? view.RightDirection : view.UpDirection;
                var p1 = first + (offsetDir * (Stagger * (1 + index++)));
                var dim = doc.Document.FamilyCreate.NewLinearDimension(view, Line.CreateBound(p1, p1 + span), refs);
                if (spec.Equality == true) dim.AreSegmentsEqual = true;
                if (spec.Label is { } label) labels.Add((dim, FamilyRefs.Param(doc, label)));
                else if (spec.Locked is not null) dim.IsLocked = true;
                logs.Add(new LogEntry(slug).Success($"{string.Join(" | ", spec.Between)}{(spec.Label is null ? "" : $" = {spec.Label}")}{(spec.Equality == true ? " EQ" : "")}"));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        doc.LabelDimensions(labels);
        return new OperationLog(this.Name, logs);
    }

    private static (Reference Reference, Plane Plane) Resolve(FamilyDocument doc, string name) {
        if (FamilyRefs.FindRefLine(doc, name) is { } line) {
            var l = (Line)line.GeometryCurve;
            return (l.Reference, Plane.CreateByNormalAndOrigin(l.Direction.CrossProduct(line.SketchPlane.GetPlane().Normal), l.Origin));
        }
        return FamilyRefs.Resolve(doc, name);
    }
}
