using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>A detail item instance placed in a stock view and aligned, or a loop of symbolic lines locked to planes.</summary>
public sealed class PlaceDetails((string Slug, FamilyModelDetail Spec)[] details, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    public override string Description => $"Place {details.Length} details: {string.Join(", ", details.Select(d => d.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        var logs = new List<LogEntry>();
        foreach (var (slug, spec) in details) {
            try {
                var view = FamilyRefs.ViewFor(doc, spec.View);
                if (spec.Family is { } family) {
                    var symbol = new FilteredElementCollector(doc).OfClass(typeof(FamilySymbol)).Cast<FamilySymbol>()
                                     .FirstOrDefault(s => s.Family.Name == family && (spec.Type is null || s.Name == spec.Type))
                                 ?? throw new InvalidOperationException($"Detail family '{family}' is not loaded in this family.");
                    if (!symbol.IsActive) symbol.Activate();
                    var instance = doc.Document.FamilyCreate.NewFamilyInstance(XYZ.Zero, symbol, view);
                    doc.Document.Regenerate();
                    foreach (var align in spec.Align ?? []) {
                        var (hostRef, _) = FamilyRefs.Resolve(doc, align.To);
                        var nestedRef = instance.GetReferenceByName(align.Instance) ?? throw new InvalidOperationException($"'{family}' exposes no '{align.Instance}'.");
                        FamilyRefs.Align(doc, view, hostRef, nestedRef);
                    }
                } else {
                    var viewPlane = Plane.CreateByNormalAndOrigin(view.ViewDirection, view.Origin);
                    var sketch = SketchPlane.Create(doc, viewPlane);
                    foreach (var loop in spec.Curves ?? []) {
                        var lines = loop.Curves.Where(c => c.Kind == CurveKind.Line).ToList();
                        for (var i = 0; i < lines.Count; i++) {
                            var previous = lines[(i - 1 + lines.Count) % lines.Count];
                            var next = lines[(i + 1) % lines.Count];
                            var p0 = FamilyRefs.Intersect(viewPlane, FamilyRefs.Resolve(doc, previous.On!).Plane, FamilyRefs.Resolve(doc, lines[i].On!).Plane);
                            var p1 = FamilyRefs.Intersect(viewPlane, FamilyRefs.Resolve(doc, lines[i].On!).Plane, FamilyRefs.Resolve(doc, next.On!).Plane);
                            var symbolic = doc.Document.FamilyCreate.NewSymbolicCurve(Line.CreateBound(p0, p1), sketch);
                            FamilyRefs.Align(doc, view, symbolic.GeometryCurve.Reference, FamilyRefs.Resolve(doc, lines[i].On!).Reference);
                        }
                    }
                }
                logs.Add(new LogEntry(slug).Success($"Detail in {spec.View}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }
}
