using Autodesk.Revit.DB;
using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Serilog;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Recreates constrained extrusions from canonical reference-plane specs.
///     V1 fully supports constrained rectangles.
/// </summary>
public class MakeConstrainedExtrusions(MakeConstrainedExtrusionsSettings settings)
    : DocOperation<MakeConstrainedExtrusionsSettings>(settings) {
    private const double PlaneTolerance = 1e-6;

    public override string Description => "Create canonical reference-plane-constrained extrusions";

    public override OperationLog Execute(
        FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext
    ) {
        var logs = new List<LogEntry>();

        foreach (var spec in this.Settings.Rectangles)
            CreateRectangle(doc.Document, spec, logs);

        foreach (var circle in this.Settings.Circles)
            CreateCircle(doc.Document, circle, logs);

        return new OperationLog(this.Name, logs);
    }

    private static void CreateRectangle(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        List<LogEntry> logs
    ) {
        var key = $"Rectangle extrusion: {spec.Name}";

        var rpA1 = GetReferencePlane(doc, spec.PairAPlane1);
        var rpA2 = GetReferencePlane(doc, spec.PairAPlane2);
        var rpB1 = GetReferencePlane(doc, spec.PairBPlane1);
        var rpB2 = GetReferencePlane(doc, spec.PairBPlane2);
        if (rpA1 == null || rpA2 == null || rpB1 == null || rpB2 == null) {
            logs.Add(new LogEntry(key).Error("One or more required reference planes were not found."));
            return;
        }

        var sketchPlane = GetSketchPlane(doc, spec.SketchPlaneName);
        if (sketchPlane == null) {
            logs.Add(new LogEntry(key).Error($"Sketch plane '{spec.SketchPlaneName}' was not found."));
            return;
        }

        var sketchGeomPlane = sketchPlane.GetPlane();
        if (!TryIntersect3Planes(rpA1, rpB1, sketchGeomPlane, out var p00) ||
            !TryIntersect3Planes(rpA1, rpB2, sketchGeomPlane, out var p01) ||
            !TryIntersect3Planes(rpA2, rpB2, sketchGeomPlane, out var p11) ||
            !TryIntersect3Planes(rpA2, rpB1, sketchGeomPlane, out var p10)) {
            logs.Add(new LogEntry(key).Error("Could not resolve rectangle corner intersections from reference planes."));
            return;
        }

        var c0 = Line.CreateBound(p00, p01);
        var c1 = Line.CreateBound(p01, p11);
        var c2 = Line.CreateBound(p11, p10);
        var c3 = Line.CreateBound(p10, p00);

        var loop = new CurveArray();
        loop.Append(c0);
        loop.Append(c1);
        loop.Append(c2);
        loop.Append(c3);

        var profile = new CurveArrArray();
        profile.Append(loop);

        var startOffset = spec.StartOffset;
        var endOffset = spec.EndOffset;
        ReferencePlane? bottomHeightPlane = null;
        ReferencePlane? topHeightPlane = null;

        var hasHeightPair = !string.IsNullOrWhiteSpace(spec.HeightPlaneBottom) &&
                            !string.IsNullOrWhiteSpace(spec.HeightPlaneTop);
        if (hasHeightPair) {
            bottomHeightPlane = GetReferencePlane(doc, spec.HeightPlaneBottom!);
            topHeightPlane = GetReferencePlane(doc, spec.HeightPlaneTop!);
            if (bottomHeightPlane == null || topHeightPlane == null) {
                logs.Add(new LogEntry(key).Error("Height constraint planes were configured but could not be found."));
                return;
            }

            var sketchNormal = sketchGeomPlane.Normal.Normalize();
            var dBottom = SignedDistanceToPlaneAlongNormal(bottomHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
            var dTop = SignedDistanceToPlaneAlongNormal(topHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
            startOffset = Math.Min(dBottom, dTop);
            endOffset = Math.Max(dBottom, dTop);
        }

        Extrusion extrusion;
        try {
            extrusion = doc.FamilyCreate.NewExtrusion(spec.IsSolid, profile, sketchPlane, endOffset);
            extrusion.StartOffset = startOffset;
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error(ex));
            return;
        }

        TryAlignSketchLinesToPlanes(doc, extrusion, [rpA1, rpA2, rpB1, rpB2], logs, key);
        if (hasHeightPair && bottomHeightPlane != null && topHeightPlane != null)
            TryAlignExtrusionCapsToHeightPlanes(doc, extrusion, sketchGeomPlane.Normal.Normalize(), bottomHeightPlane, topHeightPlane, logs, key);

        logs.Add(new LogEntry(key).Success("Created and constrained to reference planes."));
    }

    private static void CreateCircle(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        List<LogEntry> logs
    ) {
        var key = $"Circle extrusion: {spec.Name}";

        var rpA1 = GetReferencePlane(doc, spec.PairAPlane1);
        var rpA2 = GetReferencePlane(doc, spec.PairAPlane2);
        var rpB1 = GetReferencePlane(doc, spec.PairBPlane1);
        var rpB2 = GetReferencePlane(doc, spec.PairBPlane2);
        if (rpA1 == null || rpA2 == null || rpB1 == null || rpB2 == null) {
            logs.Add(new LogEntry(key).Error("One or more required reference planes were not found."));
            return;
        }

        var sketchPlane = GetSketchPlane(doc, spec.SketchPlaneName);
        if (sketchPlane == null) {
            logs.Add(new LogEntry(key).Error($"Sketch plane '{spec.SketchPlaneName}' was not found."));
            return;
        }

        var sketchGeomPlane = sketchPlane.GetPlane();
        if (!TryIntersect3Planes(rpA1, rpB1, sketchGeomPlane, out var p00) ||
            !TryIntersect3Planes(rpA1, rpB2, sketchGeomPlane, out var p01) ||
            !TryIntersect3Planes(rpA2, rpB2, sketchGeomPlane, out var p11) ||
            !TryIntersect3Planes(rpA2, rpB1, sketchGeomPlane, out var p10)) {
            logs.Add(new LogEntry(key).Error("Could not resolve cylinder diameter intersections from reference planes."));
            return;
        }

        var center = new XYZ(
            (p00.X + p01.X + p11.X + p10.X) / 4.0,
            (p00.Y + p01.Y + p11.Y + p10.Y) / 4.0,
            (p00.Z + p01.Z + p11.Z + p10.Z) / 4.0);
        var diameterA = p00.DistanceTo(p10);
        var diameterB = p00.DistanceTo(p01);
        var radius = Math.Min(diameterA, diameterB) / 2.0;
        Log.Debug(
            "[MakeConstrainedExtrusions] Circle {CircleName} using planes {PairA1}, {PairA2}, {PairB1}, {PairB2} on sketch {SketchPlane}. Computed center {Center}, diameterA {DiameterA}, diameterB {DiameterB}, radius {Radius}.",
            spec.Name,
            spec.PairAPlane1,
            spec.PairAPlane2,
            spec.PairBPlane1,
            spec.PairBPlane2,
            spec.SketchPlaneName,
            center,
            diameterA,
            diameterB,
            radius);
        if (radius <= PlaneTolerance) {
            logs.Add(new LogEntry(key).Error("Resolved cylinder radius was zero or negative."));
            return;
        }

        var (xVec, yVec) = BuildStablePlaneAxes(sketchGeomPlane.Normal.Normalize());
        var right = center + (xVec * radius);
        var left = center - (xVec * radius);
        var top = center + (yVec * radius);
        var bottom = center - (yVec * radius);
        var arc1 = Arc.Create(left, right, top);
        var arc2 = Arc.Create(right, left, bottom);

        var loop = new CurveArray();
        loop.Append(arc1);
        loop.Append(arc2);

        var profile = new CurveArrArray();
        profile.Append(loop);

        var startOffset = spec.StartOffset;
        var endOffset = spec.EndOffset;
        ReferencePlane? bottomHeightPlane = null;
        ReferencePlane? topHeightPlane = null;
        var hasHeightPair = !string.IsNullOrWhiteSpace(spec.HeightPlaneBottom) &&
                            !string.IsNullOrWhiteSpace(spec.HeightPlaneTop);
        if (hasHeightPair) {
            bottomHeightPlane = GetReferencePlane(doc, spec.HeightPlaneBottom!);
            topHeightPlane = GetReferencePlane(doc, spec.HeightPlaneTop!);
            if (bottomHeightPlane == null || topHeightPlane == null) {
                logs.Add(new LogEntry(key).Error("Height constraint planes were configured but could not be found."));
                return;
            }

            var sketchNormal = sketchGeomPlane.Normal.Normalize();
            var dBottom = SignedDistanceToPlaneAlongNormal(bottomHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
            var dTop = SignedDistanceToPlaneAlongNormal(topHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
            startOffset = Math.Min(dBottom, dTop);
            endOffset = Math.Max(dBottom, dTop);
        }

        try {
            var extrusion = doc.FamilyCreate.NewExtrusion(spec.IsSolid, profile, sketchPlane, endOffset);
            extrusion.StartOffset = startOffset;
            if (hasHeightPair && bottomHeightPlane != null && topHeightPlane != null) {
                TryAlignExtrusionCapsToHeightPlanes(
                    doc,
                    extrusion,
                    sketchGeomPlane.Normal.Normalize(),
                    bottomHeightPlane,
                    topHeightPlane,
                    logs,
                    key);
            }

            logs.Add(new LogEntry(key).Success("Created from ParamDrivenSolids circle plan."));
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error(ex));
        }
    }

    private static void TryAlignExtrusionCapsToHeightPlanes(
        Document doc,
        Extrusion extrusion,
        XYZ sketchNormal,
        ReferencePlane bottomPlane,
        ReferencePlane topPlane,
        List<LogEntry> logs,
        string key
    ) {
        try {
            var alignView = GetBestAlignmentView(doc, bottomPlane, topPlane);
            var opts = new Options { ComputeReferences = true };
            var geom = extrusion.get_Geometry(opts);
            var solid = geom.OfType<Solid>().FirstOrDefault(s => s.Faces.Size > 0);
            if (solid == null)
                return;

            PlanarFace? minFace = null;
            PlanarFace? maxFace = null;
            var minDist = double.MaxValue;
            var maxDist = double.MinValue;

            foreach (var face in solid.Faces.OfType<PlanarFace>()) {
                var dot = face.FaceNormal.Normalize().DotProduct(sketchNormal);
                if (Math.Abs(Math.Abs(dot) - 1.0) > 1e-4)
                    continue;

                var signed = face.Origin.DotProduct(sketchNormal);
                if (signed < minDist) {
                    minDist = signed;
                    minFace = face;
                }

                if (signed > maxDist) {
                    maxDist = signed;
                    maxFace = face;
                }
            }

            if (minFace?.Reference != null)
                TryCreateAlignment(doc, alignView, minFace.Reference, bottomPlane.GetReference());
            if (maxFace?.Reference != null)
                TryCreateAlignment(doc, alignView, maxFace.Reference, topPlane.GetReference());
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created extrusion, but failed height face alignment: {ex.Message}"));
        }
    }

    private static void TryCreateAlignment(Document doc, View view, Reference faceRef, Reference planeRef) {
        try {
            _ = doc.FamilyCreate.NewAlignment(view, faceRef, planeRef);
        } catch {
            // Retry swapped order for edge cases where one reference position is rejected.
            _ = doc.FamilyCreate.NewAlignment(view, planeRef, faceRef);
        }
    }

    private static View? GetWorkingView(Document doc) {
        if (doc.ActiveView != null && !doc.ActiveView.IsTemplate)
            return doc.ActiveView;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(view =>
                !view.IsTemplate &&
                view.ViewType is ViewType.FloorPlan or ViewType.CeilingPlan or ViewType.EngineeringPlan or ViewType.AreaPlan);
    }

    private static View? GetBestAlignmentView(Document doc, ReferencePlane p1, ReferencePlane p2) {
        var isHeightLike = Math.Abs(p1.Normal.Normalize().Z) > 0.95 &&
                           Math.Abs(p2.Normal.Normalize().Z) > 0.95;
        if (!isHeightLike)
            return GetWorkingView(doc);

        var elevation = new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(v =>
                !v.IsTemplate &&
                (v.ViewType == ViewType.Elevation || v.ViewType == ViewType.Section));

        return elevation ?? GetWorkingView(doc);
    }

    private static void TryAlignSketchLinesToPlanes(
        Document doc,
        Extrusion extrusion,
        List<ReferencePlane> planes,
        List<LogEntry> logs,
        string key
    ) {
        try {
            var alignmentView = GetWorkingView(doc);
            if (alignmentView == null) {
                logs.Add(new LogEntry(key).Error("Created extrusion, but no valid view was available for sketch alignment."));
                return;
            }

            var modelLines = extrusion.Sketch.GetAllElements()
                .Select(id => doc.GetElement(id))
                .OfType<ModelCurve>()
                .Where(mc => mc.GeometryCurve is Line)
                .ToList();

            foreach (var plane in planes) {
                var matchingLine = modelLines.FirstOrDefault(line =>
                    IsCurveOnPlane(line.GeometryCurve, plane));
                if (matchingLine == null)
                    continue;

                _ = doc.FamilyCreate.NewAlignment(alignmentView, matchingLine.GeometryCurve.Reference, plane.GetReference());
            }
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created extrusion, but failed to apply one or more alignments: {ex.Message}"));
        }
    }

    private static bool IsCurveOnPlane(Curve curve, ReferencePlane plane) {
        if (!curve.IsBound)
            return false;

        var p0 = curve.GetEndPoint(0);
        var p1 = curve.GetEndPoint(1);
        return IsPointOnPlane(p0, plane) && IsPointOnPlane(p1, plane);
    }

    private static bool IsPointOnPlane(XYZ point, ReferencePlane plane) {
        var p = plane.BubbleEnd;
        var n = plane.Normal;
        var signed = (point - p).DotProduct(n);
        return Math.Abs(signed) <= PlaneTolerance;
    }

    private static double SignedDistanceToPlaneAlongNormal(XYZ point, XYZ planeOrigin, XYZ normalizedPlaneNormal) =>
        (point - planeOrigin).DotProduct(normalizedPlaneNormal);

    private static (XYZ XVec, XYZ YVec) BuildStablePlaneAxes(XYZ normal) {
        var seed = Math.Abs(normal.Z) > 0.9 ? XYZ.BasisX : XYZ.BasisZ;
        var xVec = seed.CrossProduct(normal).Normalize();
        var yVec = normal.CrossProduct(xVec).Normalize();
        return (xVec, yVec);
    }

    private static ReferencePlane? GetReferencePlane(Document doc, string name) =>
        ResolveReferencePlane(doc, name);

    private static SketchPlane? GetSketchPlane(Document doc, string name) =>
        ResolveSketchPlane(doc, name);

    private static ReferencePlane? ResolveReferencePlane(Document doc, string requestedName) {
        if (string.IsNullOrWhiteSpace(requestedName))
            return null;

        var planes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .ToList();

        var exact = planes.FirstOrDefault(rp => rp.Name == requestedName);
        if (exact != null)
            return exact;

        foreach (var alias in GetLevelAliases(requestedName)) {
            var aliased = planes.FirstOrDefault(rp => rp.Name == alias);
            if (aliased != null)
                return aliased;
        }

        if (requestedName.IndexOf("level", StringComparison.OrdinalIgnoreCase) < 0)
            return null;

        return planes.FirstOrDefault(rp =>
            !string.IsNullOrWhiteSpace(rp.Name) &&
            rp.Name.IndexOf("level", StringComparison.OrdinalIgnoreCase) >= 0 &&
            Math.Abs(rp.Normal.Normalize().Z) > 0.95);
    }

    private static SketchPlane? ResolveSketchPlane(Document doc, string requestedName) {
        if (string.IsNullOrWhiteSpace(requestedName))
            return null;

        var sketchPlanes = new FilteredElementCollector(doc)
            .OfClass(typeof(SketchPlane))
            .Cast<SketchPlane>()
            .ToList();

        var exact = sketchPlanes.FirstOrDefault(sp => sp.Name == requestedName);
        if (exact != null)
            return exact;

        foreach (var alias in GetLevelAliases(requestedName)) {
            var aliased = sketchPlanes.FirstOrDefault(sp => sp.Name == alias);
            if (aliased != null)
                return aliased;
        }

        // Canonical fallback: requested name may refer to a ReferencePlane datum, not a SketchPlane.
        var rp = ResolveReferencePlane(doc, requestedName);
        if (rp != null) {
            try {
                return SketchPlane.Create(doc, rp.Id);
            } catch {
                // Continue to other fallback strategies below.
            }
        }

        if (requestedName.IndexOf("level", StringComparison.OrdinalIgnoreCase) < 0)
            return null;

        return sketchPlanes.FirstOrDefault(sp =>
            !string.IsNullOrWhiteSpace(sp.Name) &&
            sp.Name.IndexOf("level", StringComparison.OrdinalIgnoreCase) >= 0);
    }

    private static IEnumerable<string> GetLevelAliases(string requestedName) {
        if (!requestedName.Equals("Ref. Level", StringComparison.OrdinalIgnoreCase))
            return [];

        return [
            "Reference Level",
            "Ref Level",
            "Lower Ref. Level",
            "Lower Reference Level",
            "Level"
        ];
    }

    private static bool TryIntersect3Planes(
        ReferencePlane p1,
        ReferencePlane p2,
        Plane p3,
        out XYZ intersection
    ) {
        var n1 = p1.Normal;
        var n2 = p2.Normal;
        var n3 = p3.Normal;

        var d1 = n1.DotProduct(p1.BubbleEnd);
        var d2 = n2.DotProduct(p2.BubbleEnd);
        var d3 = n3.DotProduct(p3.Origin);

        var n2xn3 = n2.CrossProduct(n3);
        var n3xn1 = n3.CrossProduct(n1);
        var n1xn2 = n1.CrossProduct(n2);

        var denominator = n1.DotProduct(n2xn3);
        if (Math.Abs(denominator) < PlaneTolerance) {
            intersection = XYZ.Zero;
            return false;
        }

        intersection = (n2xn3 * d1 + n3xn1 * d2 + n1xn2 * d3) * (1.0 / denominator);
        return true;
    }
}
