using Pe.Revit.Extensions.FamDocument;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Operations;

/// <summary>
///     Create extrusions (the only form kind). Each profile line lies on a named plane and is locked to it;
///     the circle sits on two crossing planes with a labeled or locked diameter; the extrusion spans `start` to
///     `end` planes and its caps are aligned to them. Refuses a sketch plane that is a reference line
///     (`form-sketch-plane-on-reference-line`). Harvested from ConstrainedExtrusionFactory: NewExtrusion,
///     lock-line-to-plane, cap alignment, terminal face.
/// </summary>
public sealed class MakeForms((string Slug, FamilyModelForm Spec)[] forms, FamilyModel model) : DocOperation<DefaultOperationSettings>(new DefaultOperationSettings()) {
    private const double SeedDepth = 0.5 / 12.0;

    public override string Description => $"Create {forms.Length} extrusions: {string.Join(", ", forms.Select(f => f.Slug))}";

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext g) {
        // Dimension labels move the planes; settle them before reading profile coordinates.
        doc.Document.Regenerate();
        var logs = new List<LogEntry>();
        foreach (var (slug, spec) in forms) {
            try {
                if (spec.Kind != FormKind.Extrusion) throw new InvalidOperationException($"'{spec.Kind}' reached the compiler unexpanded.");
                var sketchPlane = FamilyRefs.SketchPlaneFor(doc, spec.SketchPlane!);
                var plane = sketchPlane.GetPlane();
                var normal = plane.Normal.Normalize();
                var locks = new List<(Curve Curve, string Plane)>();
                var profile = new CurveArrArray();
                foreach (var loop in spec.Profile!) {
                    var array = new CurveArray();
                    var lines = loop.Curves.Where(c => c.Kind == CurveKind.Line).ToList();
                    for (var i = 0; i < lines.Count; i++) {
                        var previous = lines[(i - 1 + lines.Count) % lines.Count];
                        var next = lines[(i + 1) % lines.Count];
                        var p0 = FamilyRefs.Intersect(plane, FamilyRefs.Resolve(doc, previous.On!).Plane, FamilyRefs.Resolve(doc, lines[i].On!).Plane);
                        var p1 = FamilyRefs.Intersect(plane, FamilyRefs.Resolve(doc, lines[i].On!).Plane, FamilyRefs.Resolve(doc, next.On!).Plane);
                        var line = Line.CreateBound(p0, p1);
                        array.Append(line);
                        locks.Add((line, lines[i].On!));
                    }
                    foreach (var circle in loop.Curves.Where(c => c.Kind == CurveKind.Circle)) {
                        var center = FamilyRefs.Intersect(plane, FamilyRefs.Resolve(doc, circle.Center![0]).Plane, FamilyRefs.Resolve(doc, circle.Center[1]).Plane);
                        var radius = FamilyRefs.Feet(doc, circle.Diameter!.Value) / 2;
                        var (x, y) = Axes(normal);
                        array.Append(Ellipse.CreateCurve(center, radius, radius, x, y, -Math.PI, Math.PI));
                    }
                    profile.Append(array);
                }

                var start = spec.Start is { } s ? Offset(doc, plane, s) : 0.0;
                var end = spec.End is { } e ? Offset(doc, plane, e) : start + 1.0;
                var extrusion = doc.Document.FamilyCreate.NewExtrusion(spec.Void != true, profile, sketchPlane, Math.Max(Math.Abs(end - start), SeedDepth));
                extrusion.StartOffset = Math.Min(start, end);
                extrusion.EndOffset = Math.Max(start, end);
                doc.Document.Regenerate();

                var view = FamilyRefs.ViewFor(doc, null, normal);
                foreach (var sketchCurve in extrusion.Sketch.GetAllElements().Select(id => doc.Document.GetElement(id)).OfType<ModelCurve>()) {
                    var hit = locks.FirstOrDefault(l => l.Curve is Line a && sketchCurve.GeometryCurve is Line b &&
                        (a.GetEndPoint(0).IsAlmostEqualTo(b.GetEndPoint(0)) && a.GetEndPoint(1).IsAlmostEqualTo(b.GetEndPoint(1)) ||
                         a.GetEndPoint(0).IsAlmostEqualTo(b.GetEndPoint(1)) && a.GetEndPoint(1).IsAlmostEqualTo(b.GetEndPoint(0))));
                    if (hit.Plane is not null) FamilyRefs.Align(doc, view, sketchCurve.GeometryCurve.Reference, FamilyRefs.Resolve(doc, hit.Plane).Reference);
                    else if (sketchCurve.CenterPointReference is { } centerRef && spec.Profile.SelectMany(l => l.Curves).FirstOrDefault(c => c.Kind == CurveKind.Circle) is { } circle) {
                        FamilyRefs.Align(doc, view, FamilyRefs.Resolve(doc, circle.Center![0]).Reference, centerRef);
                        FamilyRefs.Align(doc, view, FamilyRefs.Resolve(doc, circle.Center[1]).Reference, centerRef);
                        if (circle.Diameter is { Parameter: { } dp } && sketchCurve.GeometryCurve is Arc arc && arc.Reference is not null) {
                            var dim = doc.Document.FamilyCreate.NewDiameterDimension(view, arc.Reference, arc.Center + (arc.XDirection * arc.Radius * 0.5));
                            dim.FamilyLabel = FamilyRefs.Param(doc, dp);
                        }
                    }
                }
                AlignCaps(doc, extrusion, normal, spec.Start ?? spec.SketchPlane!, spec.End, logs, slug);
                if (spec.Subcategory is { } sub) {
                    var parent = doc.Document.OwnerFamily.FamilyCategory;
                    var category = parent.SubCategories.Cast<Category>().FirstOrDefault(c => c.Name == sub) ?? doc.Document.Settings.Categories.NewSubcategory(parent, sub);
                    _ = extrusion.get_Parameter(BuiltInParameter.FAMILY_ELEM_SUBCATEGORY)?.Set(category.Id);
                }
                if (spec.Material is { } material && extrusion.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM) is { } mp)
                    FamilyRefs.Associate(doc, mp, material, logs, slug);
                logs.Add(new LogEntry(slug).Success($"Extrusion on {spec.SketchPlane}, {locks.Count} locked lines, {spec.Start} → {spec.End}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    private static double Offset(FamilyDocument doc, Plane sketch, string planeName) {
        var (_, p) = FamilyRefs.Resolve(doc, planeName);
        return (p.Origin - sketch.Origin).DotProduct(sketch.Normal.Normalize());
    }

    private static (XYZ X, XYZ Y) Axes(XYZ normal) {
        var seed = Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ;
        var x = seed.CrossProduct(normal).Normalize();
        return (x, normal.CrossProduct(x).Normalize());
    }

    private static void AlignCaps(FamilyDocument doc, Extrusion extrusion, XYZ normal, string startPlane, string? endPlane, List<LogEntry> logs, string key) {
        if (endPlane is null) return;
        try {
            var solid = extrusion.get_Geometry(new Options { ComputeReferences = true }).OfType<Solid>().FirstOrDefault(s => s.Faces.Size > 0);
            if (solid is null) return;
            var caps = solid.Faces.OfType<PlanarFace>().Where(f => Math.Abs(Math.Abs(f.FaceNormal.Normalize().DotProduct(normal)) - 1) < 1e-4).OrderBy(f => f.Origin.DotProduct(normal)).ToList();
            if (caps.Count < 2) return;
            var view = FamilyRefs.ViewFor(doc, null, Math.Abs(normal.Z) > 0.95 ? XYZ.BasisX : XYZ.BasisZ);
            var (startRef, startGeom) = FamilyRefs.Resolve(doc, startPlane);
            var (endRef, endGeom) = FamilyRefs.Resolve(doc, endPlane);
            var startFirst = startGeom.Origin.DotProduct(normal) <= endGeom.Origin.DotProduct(normal);
            FamilyRefs.Align(doc, view, caps[0].Reference, startFirst ? startRef : endRef);
            FamilyRefs.Align(doc, view, caps[^1].Reference, startFirst ? endRef : startRef);
        } catch (Exception ex) { logs.Add(new LogEntry(key).Error($"Created extrusion, but cap alignment failed: {ex.Message}")); }
    }

    /// <summary>The planar face of an extrusion coplanar with a named plane; connectors sit on it.</summary>
    internal static PlanarFace? FaceOn(Document doc, Extrusion extrusion, Plane plane) {
        var solid = extrusion.get_Geometry(new Options { ComputeReferences = true }).OfType<Solid>().FirstOrDefault(s => s.Faces.Size > 0);
        return solid?.Faces.OfType<PlanarFace>().FirstOrDefault(f =>
            Math.Abs(Math.Abs(f.FaceNormal.Normalize().DotProduct(plane.Normal.Normalize())) - 1) < 1e-4 &&
            Math.Abs((f.Origin - plane.Origin).DotProduct(plane.Normal.Normalize())) < 1e-6);
    }
}
