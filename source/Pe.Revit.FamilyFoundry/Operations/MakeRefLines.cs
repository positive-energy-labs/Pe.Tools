using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Create named reference lines on a work plane from the intersection of two crossing planes, with an
///     optional labeled angular dimension from `angleFrom` (the rotation hinge, live-proven).
/// </summary>
public sealed class MakeRefLines((string Name, FamilyModelRefLine Spec)[] lines, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Create {lines.Length} reference lines: {string.Join(", ", lines.Select(l => l.Name))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (name, spec) in lines) {
            try {
                if (FamilyRefs.FindRefLine(doc, name) is not null) { logs.Add(new LogEntry(name).Skip("Already exists.")); continue; }
                var (_, on) = FamilyRefs.Resolve(doc, spec.On);
                var (_, a) = FamilyRefs.Resolve(doc, spec.From[0]);
                var (_, b) = FamilyRefs.Resolve(doc, spec.From[1]);
                var start = FamilyRefs.Intersect(on, a, b);
                var length = FamilyRefs.Feet(doc, spec.Length);
                var angleFrom = spec.AngleFrom is { } af ? FamilyRefs.Resolve(doc, af).Plane : a;
                var along = on.Normal.CrossProduct(angleFrom.Normal).Normalize();
                var angle = spec.Angle is { Degrees: { } deg } ? deg * Math.PI / 180 : spec.Angle is { Parameter: { } ap } ? AngleOf(doc, ap) : 0;
                var direction = Transform.CreateRotationAtPoint(on.Normal, angle, start).OfVector(along);
                var sketch = FamilyRefs.SketchPlaneFor(doc, spec.On);
                var curve = doc.Document.FamilyCreate.NewModelCurve(Line.CreateBound(start, start + (direction * length)), sketch);
                curve.ChangeToReferenceLine();
                curve.Name = name;
                if (spec.Angle is { Parameter: { } label } && spec.AngleFrom is { } fromName) {
                    var view = FamilyRefs.ViewFor(doc, null, on.Normal);
                    var arc = Arc.Create(start, length * 0.5, 0, angle == 0 ? 0.1 : angle, along, on.Normal.CrossProduct(along));
                    var dim = doc.Document.FamilyCreate.NewAngularDimension(view, arc, FamilyRefs.Resolve(doc, fromName).Reference, curve.GeometryCurve.Reference);
                    dim.FamilyLabel = FamilyRefs.Param(doc, label);
                }
                logs.Add(new LogEntry(name).Success($"Created on {spec.On} from {spec.From[0]} × {spec.From[1]}."));
            } catch (Exception ex) { logs.Add(new LogEntry(name).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    private static double AngleOf(FamilyDocument doc, string parameter) {
        var p = FamilyRefs.Param(doc, parameter);
        var t = doc.FamilyManager.CurrentType;
        return t is not null && t.HasValue(p) ? t.AsDouble(p) ?? 0 : 0;
    }
}
