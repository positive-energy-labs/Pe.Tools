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
                var sketchCurves = new List<(Curve Curve, FamilyModelSketchCurve Spec)>();
                var profile = new CurveArrArray();
                foreach (var loop in spec.Profile!) {
                    var array = new CurveArray();
                    foreach (var (curve, item) in FamilyRefs.SketchCurves(doc, plane, loop)) {
                        array.Append(curve);
                        sketchCurves.Add((curve, item));
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
                    var hit = sketchCurves.FirstOrDefault(item => FamilyRefs.SameCurve(item.Curve, sketchCurve.GeometryCurve));
                    if (hit.Spec is null) throw new InvalidOperationException($"Revit sketch curve {FamilyRefs.DescribeCurve(sketchCurve.GeometryCurve)} does not match authored profiles: {string.Join("; ", sketchCurves.Select(item => FamilyRefs.DescribeCurve(item.Curve)))}.");
                    FamilyRefs.ConstrainSketchCurve(doc, view, sketchCurve, hit.Spec);
                }
                AlignCaps(doc, extrusion, normal, spec.Start ?? spec.SketchPlane!, spec.End, logs, slug);
                if (spec.Subcategory is { } sub) {
                    var parent = doc.Document.OwnerFamily.FamilyCategory;
                    var category = parent.SubCategories.Cast<Category>().FirstOrDefault(c => c.Name == sub) ?? doc.Document.Settings.Categories.NewSubcategory(parent, sub);
                    _ = extrusion.get_Parameter(BuiltInParameter.FAMILY_ELEM_SUBCATEGORY)?.Set(category.Id);
                }
                if (spec.Material is { } material && extrusion.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM) is { } mp)
                    FamilyRefs.Associate(doc, mp, material, logs, slug);
                SetVisibility.ApplyViews(extrusion, spec.Visibility);
                logs.Add(new LogEntry(slug).Success($"Extrusion on {spec.SketchPlane}, {sketchCurves.Count} constrained curves, {spec.Start} → {spec.End}."));
            } catch (Exception ex) { logs.Add(new LogEntry(slug).Error(ex)); }
        }
        return new OperationLog(this.Name, logs);
    }

    private static double Offset(FamilyDocument doc, Plane sketch, string planeName) {
        var (_, p) = FamilyRefs.Resolve(doc, planeName);
        return (p.Origin - sketch.Origin).DotProduct(sketch.Normal.Normalize());
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
