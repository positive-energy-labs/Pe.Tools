using Autodesk.Revit.DB;
using Pe.Revit.Extensions.FamDocument;
using Pe.FamilyFoundry.Snapshots;
using Serilog;

namespace Pe.FamilyFoundry.Helpers;

internal static class ConstrainedExtrusionFactory {
    private const double PlaneTolerance = 1e-6;
    private const double DefaultSeedDiameter = 0.5 / 12.0;
    private const double DefaultSeedDepth = 0.5 / 12.0;

    public static ExtrusionCreationResult CreateRectangle(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        List<LogEntry> logs,
        string key,
        SketchPlane? sketchPlaneOverride = null
    ) {
        var rpA1 = GetReferencePlane(doc, spec.PairAPlane1);
        var rpA2 = GetReferencePlane(doc, spec.PairAPlane2);
        var rpB1 = GetReferencePlane(doc, spec.PairBPlane1);
        var rpB2 = GetReferencePlane(doc, spec.PairBPlane2);
        if (rpA1 == null || rpA2 == null || rpB1 == null || rpB2 == null) {
            logs.Add(new LogEntry(key).Error("One or more required reference planes were not found."));
            return ExtrusionCreationResult.Failed;
        }

        var sketchPlane = sketchPlaneOverride ?? GetSketchPlane(doc, spec.SketchPlaneName);
        if (sketchPlane == null) {
            logs.Add(new LogEntry(key).Error($"Sketch plane '{spec.SketchPlaneName}' was not found."));
            return ExtrusionCreationResult.Failed;
        }

        var sketchGeomPlane = sketchPlane.GetPlane();
        if (!TryIntersect3Planes(rpA1, rpB1, sketchGeomPlane, out var p00) ||
            !TryIntersect3Planes(rpA1, rpB2, sketchGeomPlane, out var p01) ||
            !TryIntersect3Planes(rpA2, rpB2, sketchGeomPlane, out var p11) ||
            !TryIntersect3Planes(rpA2, rpB1, sketchGeomPlane, out var p10)) {
            logs.Add(new LogEntry(key).Error("Could not resolve rectangle corner intersections from reference planes."));
            return ExtrusionCreationResult.Failed;
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

        var heightPlan = ResolveHeightPlan(
            doc,
            spec.HeightControlMode,
            spec.StartOffset,
            spec.EndOffset,
            spec.HeightDriver,
            spec.HeightParameter,
            spec.HeightPlaneBottom,
            spec.HeightPlaneTop,
            sketchGeomPlane,
            logs,
            key);
        if (!heightPlan.IsValid)
            return ExtrusionCreationResult.Failed;

        Extrusion extrusion;
        try {
            var seedDepth = Math.Max(Math.Abs(heightPlan.EndOffset - heightPlan.StartOffset), DefaultSeedDepth);
            extrusion = doc.FamilyCreate.NewExtrusion(spec.IsSolid, profile, sketchPlane, seedDepth);
            extrusion.EndOffset = heightPlan.EndOffset;
            extrusion.StartOffset = heightPlan.StartOffset;
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error(ex));
            return ExtrusionCreationResult.Failed;
        }

        TryAlignSketchLinesToPlanes(doc, extrusion, [rpA1, rpA2, rpB1, rpB2], logs, key);
        if (heightPlan.ShouldAlignCaps)
            TryAlignExtrusionCapsToHeightPlanes(doc, extrusion, sketchGeomPlane.Normal.Normalize(), heightPlan.BottomPlane!, heightPlan.TopPlane!, logs, key);

        var terminalFace = GetTerminalFace(extrusion, sketchGeomPlane.Normal.Normalize(), heightPlan.StartOffset, heightPlan.EndOffset);
        logs.Add(new LogEntry(key).Success("Created and constrained to reference planes."));
        return ExtrusionCreationResult.Success(extrusion, terminalFace, sketchGeomPlane.Normal.Normalize());
    }

    public static ExtrusionCreationResult CreateCircle(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        List<LogEntry> logs,
        string key,
        SketchPlane? sketchPlaneOverride = null,
        CircleExtrusionCreationOptions? options = null
    ) {
        var effectiveOptions = options ?? new CircleExtrusionCreationOptions();
        var centerPlane1 = GetReferencePlane(doc, spec.CenterPlane1);
        var centerPlane2 = GetReferencePlane(doc, spec.CenterPlane2);
        if (centerPlane1 == null || centerPlane2 == null) {
            logs.Add(new LogEntry(key).Error("One or more required cylinder center planes were not found."));
            return ExtrusionCreationResult.Failed;
        }

        var sketchPlane = sketchPlaneOverride ?? GetSketchPlane(doc, spec.SketchPlaneName);
        if (sketchPlane == null) {
            logs.Add(new LogEntry(key).Error($"Sketch plane '{spec.SketchPlaneName}' was not found."));
            return ExtrusionCreationResult.Failed;
        }

        var sketchGeomPlane = sketchPlane.GetPlane();
        if (!TryIntersect2PlanesAndSketchPlane(centerPlane1, centerPlane2, sketchGeomPlane, out var center)) {
            logs.Add(new LogEntry(key).Error("Could not resolve cylinder center from the sketch plane and center planes."));
            return ExtrusionCreationResult.Failed;
        }

        var diameter = TryGetCurrentDiameter(doc, spec.DiameterDriver, spec.DiameterParameter, out var resolvedDiameter) &&
                       resolvedDiameter > PlaneTolerance
            ? resolvedDiameter
            : DefaultSeedDiameter;

        var radius = diameter / 2.0;
        if (radius <= PlaneTolerance) {
            logs.Add(new LogEntry(key).Error("Resolved cylinder radius was zero or negative."));
            return ExtrusionCreationResult.Failed;
        }

        Log.Debug(
            "[ConstrainedExtrusionFactory] Circle {CircleName} using center planes {CenterPlane1}, {CenterPlane2} on sketch {SketchPlane}. Computed center {Center}, diameter {Diameter}, radius {Radius}.",
            spec.Name,
            spec.CenterPlane1,
            spec.CenterPlane2,
            spec.SketchPlaneName,
            center,
            diameter,
            radius);

        var loop = new CurveArray();
        var (xVec, yVec) = BuildStablePlaneAxes(sketchGeomPlane.Normal.Normalize());
        var circle = Ellipse.CreateCurve(center, radius, radius, xVec, yVec, -Math.PI, Math.PI);
        loop.Append(circle);

        var profile = new CurveArrArray();
        profile.Append(loop);

        var heightPlan = ResolveHeightPlan(
            doc,
            spec.HeightControlMode,
            spec.StartOffset,
            spec.EndOffset,
            spec.HeightDriver,
            spec.HeightParameter,
            spec.HeightPlaneBottom,
            spec.HeightPlaneTop,
            sketchGeomPlane,
            logs,
            key);
        if (!heightPlan.IsValid)
            return ExtrusionCreationResult.Failed;

        try {
            var seedDepth = Math.Max(Math.Abs(heightPlan.EndOffset - heightPlan.StartOffset), DefaultSeedDepth);
            var extrusion = doc.FamilyCreate.NewExtrusion(spec.IsSolid, profile, sketchPlane, seedDepth);
            extrusion.EndOffset = heightPlan.EndOffset;
            extrusion.StartOffset = heightPlan.StartOffset;
            if (effectiveOptions.CreateDiameterLabel)
                TryLabelCircleDiameter(doc, extrusion, spec, logs, key);
            if (effectiveOptions.AlignCenterToPlanes)
                TryAlignCircleCenterToPlanes(doc, extrusion, centerPlane1, centerPlane2, logs, key);
            if (heightPlan.ShouldAlignCaps) {
                TryAlignExtrusionCapsToHeightPlanes(
                    doc,
                    extrusion,
                    sketchGeomPlane.Normal.Normalize(),
                    heightPlan.BottomPlane!,
                    heightPlan.TopPlane!,
                    logs,
                    key);
            }

            var terminalFace = GetTerminalFace(extrusion, sketchGeomPlane.Normal.Normalize(), heightPlan.StartOffset, heightPlan.EndOffset);
            logs.Add(new LogEntry(key).Success("Created from ParamDrivenSolids circle plan."));
            return ExtrusionCreationResult.Success(extrusion, terminalFace, sketchGeomPlane.Normal.Normalize());
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error(ex));
            return ExtrusionCreationResult.Failed;
        }
    }

    public static PlanarFace? GetTerminalFace(Extrusion extrusion, XYZ sketchNormal, double startOffset, double endOffset) {
        var targetDistance = Math.Abs(endOffset) >= Math.Abs(startOffset) ? endOffset : startOffset;
        return GetCapFace(extrusion, sketchNormal, targetDistance);
    }

    private static void TryLabelCircleDiameter(
        Document doc,
        Extrusion extrusion,
        ConstrainedCircleExtrusionSpec spec,
        List<LogEntry> logs,
        string key
    ) {
        var diameterParameterName = spec.DiameterDriver.TryGetParameterName() ?? spec.DiameterParameter;
        if (string.IsNullOrWhiteSpace(diameterParameterName)) {
            return;
        }

        var diameterParameter = doc.FamilyManager.get_Parameter(diameterParameterName);
        if (diameterParameter == null) {
            logs.Add(new LogEntry(key).Error(
                $"Created extrusion, but diameter parameter '{diameterParameterName}' was not found."));
            return;
        }

        var diameterView = GetBestCircleAuthoringView(doc, extrusion);
        if (diameterView == null) {
            logs.Add(new LogEntry(key).Error(
                "Created extrusion, but no valid view was available for diameter dimension creation."));
            return;
        }

        var modelArc = extrusion.Sketch.GetAllElements()
            .Select(id => doc.GetElement(id))
            .OfType<ModelArc>()
            .FirstOrDefault();
        if (modelArc?.GeometryCurve is not Arc arc || arc.Reference == null) {
            logs.Add(new LogEntry(key).Error(
                "Created extrusion, but could not resolve a sketch arc reference for the diameter dimension."));
            return;
        }

        try {
            var origin = arc.Center + (arc.XDirection.Normalize() * (arc.Radius * 0.5));
            var dimension = doc.FamilyCreate.NewDiameterDimension(diameterView, arc.Reference, origin);
            dimension.FamilyLabel = diameterParameter;
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created extrusion, but failed diameter dimension labeling: {ex.Message}"));
        }
    }

    private static void TryAlignCircleCenterToPlanes(
        Document doc,
        Extrusion extrusion,
        ReferencePlane centerLeftRightPlane,
        ReferencePlane centerFrontBackPlane,
        List<LogEntry> logs,
        string key
    ) {
        try {
            var alignmentView = GetBestCircleAuthoringView(doc, extrusion);
            if (alignmentView == null) {
                logs.Add(new LogEntry(key).Error(
                    "Created extrusion, but no valid view was available for circle-center alignment."));
                return;
            }

            var modelArc = extrusion.Sketch.GetAllElements()
                .Select(id => doc.GetElement(id))
                .OfType<CurveElement>()
                .FirstOrDefault(curve => curve.CenterPointReference != null);
            if (modelArc?.CenterPointReference == null) {
                logs.Add(new LogEntry(key).Error(
                    "Created extrusion, but could not resolve the circle center reference."));
                return;
            }

            TryCreateAlignment(doc, alignmentView, centerLeftRightPlane.GetReference(), modelArc.CenterPointReference);
            TryCreateAlignment(doc, alignmentView, centerFrontBackPlane.GetReference(), modelArc.CenterPointReference);
        } catch (Exception ex) {
            logs.Add(new LogEntry(key).Error($"Created extrusion, but failed center-plane alignment: {ex.Message}"));
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

    private static PlanarFace? GetCapFace(Extrusion extrusion, XYZ sketchNormal, double targetDistance) {
        var opts = new Options { ComputeReferences = true };
        var geom = extrusion.get_Geometry(opts);
        var solid = geom.OfType<Solid>().FirstOrDefault(s => s.Faces.Size > 0);
        if (solid == null)
            return null;

        PlanarFace? bestFace = null;
        var bestDelta = double.MaxValue;

        foreach (var face in solid.Faces.OfType<PlanarFace>()) {
            var dot = face.FaceNormal.Normalize().DotProduct(sketchNormal);
            if (Math.Abs(Math.Abs(dot) - 1.0) > 1e-4)
                continue;

            var signed = SignedDistanceToPlaneAlongNormal(
                face.Origin,
                extrusion.Sketch.SketchPlane.GetPlane().Origin,
                sketchNormal);
            var delta = Math.Abs(signed - targetDistance);
            if (delta >= bestDelta)
                continue;

            bestDelta = delta;
            bestFace = face;
        }

        return bestFace;
    }

    private static void TryCreateAlignment(Document doc, View view, Reference faceRef, Reference planeRef) {
        try {
            _ = doc.FamilyCreate.NewAlignment(view, faceRef, planeRef);
        } catch {
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

    private static View? GetBestCircleAuthoringView(Document doc, Extrusion extrusion) {
        var sketchPlane = extrusion.Sketch?.SketchPlane;
        var sketchNormal = sketchPlane?.GetPlane().Normal.Normalize();
        if (sketchNormal == null)
            return GetWorkingView(doc);

        return Math.Abs(sketchNormal.Z) > 0.95
            ? GetWorkingView(doc)
            : GetViewMostAlignedToDirection(doc, sketchNormal, ViewType.Elevation, ViewType.Section)
              ?? GetFirstNonTemplateView(doc, ViewType.Elevation, ViewType.Section)
              ?? GetWorkingView(doc);
    }

    private static View? GetBestAlignmentView(Document doc, ReferencePlane p1, ReferencePlane p2) {
        var isHeightLike = Math.Abs(p1.Normal.Normalize().Z) > 0.95 &&
                           Math.Abs(p2.Normal.Normalize().Z) > 0.95;
        if (!isHeightLike)
            return GetWorkingView(doc);

        return GetFirstNonTemplateView(doc, ViewType.Elevation, ViewType.Section) ?? GetWorkingView(doc);
    }

    private static View? GetFirstNonTemplateView(Document doc, params ViewType[] viewTypes) =>
        new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .FirstOrDefault(view =>
                !view.IsTemplate &&
                viewTypes.Contains(view.ViewType));

    private static View? GetViewMostAlignedToDirection(
        Document doc,
        XYZ targetDirection,
        params ViewType[] viewTypes
    ) {
        var normalizedTarget = targetDirection.Normalize();

        return new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .Where(view => !view.IsTemplate && viewTypes.Contains(view.ViewType))
            .Select(view => new {
                View = view,
                Alignment = TryGetAlignmentScore(view, normalizedTarget)
            })
            .Where(candidate => candidate.Alignment != null)
            .OrderByDescending(candidate => candidate.Alignment)
            .Select(candidate => candidate.View)
            .FirstOrDefault();
    }

    private static double? TryGetAlignmentScore(View view, XYZ targetDirection) {
        try {
            var viewDirection = view.ViewDirection?.Normalize();
            if (viewDirection == null)
                return null;

            return Math.Abs(viewDirection.DotProduct(targetDirection));
        } catch {
            return null;
        }
    }

    private static void TryAlignSketchLinesToPlanes(
        Document doc,
        Extrusion extrusion,
        List<ReferencePlane> planes,
        List<LogEntry> logs,
        string key
    ) {
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

            try {
                _ = doc.FamilyCreate.NewAlignment(alignmentView, matchingLine.GeometryCurve.Reference, plane.GetReference());
            } catch (Exception ex) {
                logs.Add(new LogEntry(key).Error(
                    $"Created extrusion, but failed sketch alignment for plane '{plane.Name}': {ex.Message}"));
            }
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

    internal static SketchPlane? ResolveDirectionalSketchPlane(
        Document doc,
        string requestedName,
        bool flipNormal
    ) {
        var referencePlane = ResolveReferencePlane(doc, requestedName);
        if (referencePlane != null) {
            if (flipNormal)
                referencePlane.Flip();

            try {
                return SketchPlane.Create(doc, referencePlane.Id);
            } catch {
            }
        }

        var baseSketchPlane = ResolveSketchPlane(doc, requestedName);
        if (baseSketchPlane == null || !flipNormal)
            return baseSketchPlane;

        var basePlane = baseSketchPlane.GetPlane();
        var baseNormal = basePlane.Normal.Normalize();
        var flippedNormal = new XYZ(-baseNormal.X, -baseNormal.Y, -baseNormal.Z);

        try {
            return SketchPlane.Create(doc, Plane.CreateByNormalAndOrigin(flippedNormal, basePlane.Origin));
        } catch {
            return null;
        }
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

        var rp = ResolveReferencePlane(doc, requestedName);
        if (rp != null) {
            try {
                return SketchPlane.Create(doc, rp.Id);
            } catch {
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

    private static bool TryIntersect2PlanesAndSketchPlane(
        ReferencePlane planeA,
        ReferencePlane planeB,
        Plane sketchPlane,
        out XYZ intersection
    ) => TryIntersect3Planes(planeA, planeB, sketchPlane, out intersection);

    private static bool TryGetCurrentDiameter(
        Document doc,
        LengthDriverSpec? driver,
        string? parameterName,
        out double value
    ) {
        value = 0.0;
        if (driver.TryResolveCurrentValue(doc, out value))
            return true;

        if (string.IsNullOrWhiteSpace(parameterName))
            return false;

        return LengthDriverSpec.FromLegacyParameter(parameterName).TryResolveCurrentValue(doc, out value);
    }

    private static ResolvedExtrusionHeightPlan ResolveHeightPlan(
        Document doc,
        ExtrusionHeightControlMode mode,
        double startOffset,
        double endOffset,
        LengthDriverSpec? driver,
        string? parameterName,
        string? bottomPlaneName,
        string? topPlaneName,
        Plane sketchGeomPlane,
        List<LogEntry> logs,
        string key
    ) {
        if (mode == ExtrusionHeightControlMode.EndOffset) {
            var signedFallback = Math.Abs(endOffset - startOffset) > PlaneTolerance
                ? endOffset - startOffset
                : (Math.Abs(endOffset) > PlaneTolerance ? endOffset : DefaultSeedDepth);
            if (TryResolveHeightMagnitude(doc, driver, parameterName, out var magnitude) && Math.Abs(magnitude) > PlaneTolerance)
                signedFallback = Math.Sign(signedFallback) * Math.Abs(magnitude);

            return ResolvedExtrusionHeightPlan.FromEndOffset(
                startOffset,
                startOffset + signedFallback);
        }

        var hasHeightPair = !string.IsNullOrWhiteSpace(bottomPlaneName) && !string.IsNullOrWhiteSpace(topPlaneName);
        if (!hasHeightPair)
            return ResolvedExtrusionHeightPlan.DirectOffsets(startOffset, endOffset);

        var bottomHeightPlane = GetReferencePlane(doc, bottomPlaneName!);
        var topHeightPlane = GetReferencePlane(doc, topPlaneName!);
        if (bottomHeightPlane == null || topHeightPlane == null) {
            logs.Add(new LogEntry(key).Error("Height constraint planes were configured but could not be found."));
            return ResolvedExtrusionHeightPlan.Invalid;
        }

        var sketchNormal = sketchGeomPlane.Normal.Normalize();
        var dBottom = SignedDistanceToPlaneAlongNormal(bottomHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
        var dTop = SignedDistanceToPlaneAlongNormal(topHeightPlane.BubbleEnd, sketchGeomPlane.Origin, sketchNormal);
        return ResolvedExtrusionHeightPlan.ReferencePlane(
            Math.Min(dBottom, dTop),
            Math.Max(dBottom, dTop),
            bottomHeightPlane,
            topHeightPlane);
    }

    private static bool TryResolveHeightMagnitude(
        Document doc,
        LengthDriverSpec? driver,
        string? parameterName,
        out double value
    ) {
        value = 0.0;
        if (driver.TryResolveCurrentValue(doc, out value))
            return true;

        if (string.IsNullOrWhiteSpace(parameterName))
            return false;

        return LengthDriverSpec.FromLegacyParameter(parameterName).TryResolveCurrentValue(doc, out value);
    }
}

internal sealed class CircleExtrusionCreationOptions {
    public bool CreateDiameterLabel { get; init; } = true;
    public bool AlignCenterToPlanes { get; init; } = true;
}

internal sealed record ExtrusionCreationResult(
    bool Created,
    Extrusion? Extrusion,
    PlanarFace? TerminalFace,
    XYZ? SketchNormal
) {
    public static ExtrusionCreationResult Failed => new(false, null, null, null);

    public static ExtrusionCreationResult Success(
        Extrusion extrusion,
        PlanarFace? terminalFace,
        XYZ sketchNormal
    ) => new(true, extrusion, terminalFace, sketchNormal);
}

internal sealed record ResolvedExtrusionHeightPlan(
    bool IsValid,
    double StartOffset,
    double EndOffset,
    bool ShouldAlignCaps,
    ReferencePlane? BottomPlane,
    ReferencePlane? TopPlane
) {
    public static ResolvedExtrusionHeightPlan Invalid => new(false, 0.0, 0.0, false, null, null);

    public static ResolvedExtrusionHeightPlan DirectOffsets(double startOffset, double endOffset) =>
        new(true, startOffset, endOffset, false, null, null);

    public static ResolvedExtrusionHeightPlan FromEndOffset(double startOffset, double endOffset) =>
        new(true, startOffset, endOffset, false, null, null);

    public static ResolvedExtrusionHeightPlan ReferencePlane(
        double startOffset,
        double endOffset,
        ReferencePlane bottomPlane,
        ReferencePlane topPlane
    ) => new(true, startOffset, endOffset, true, bottomPlane, topPlane);
}
