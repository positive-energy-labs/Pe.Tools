using Pe.Extensions.FamDocument;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.Global.PolyFill;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Collects both the legacy constrained extrusion snapshot and the new semantic ParamDrivenSolids snapshot.
///     The legacy shape remains useful as an internal decompilation bridge during the first ParamDrivenSolids spike.
/// </summary>
public class ExtrusionSectionCollector : IFamilyDocCollector {
    private const double DotOrthoTolerance = 0.15;
    private const double PlaneTolerance = 1e-6;
    private const double DistanceTolerance = 1e-4;

    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.ParamDrivenSolids == null ||
        (snapshot.ParamDrivenSolids.Rectangles.Count == 0 && snapshot.ParamDrivenSolids.Cylinders.Count == 0);

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        var legacy = CollectLegacyFromFamilyDoc(famDoc.Document);
        snapshot.Extrusions = legacy;
        snapshot.ParamDrivenSolids = CollectSemanticSnapshot(
            famDoc.Document,
            legacy,
            snapshot.RefPlanesAndDims);
    }

    private static ExtrusionSnapshot CollectLegacyFromFamilyDoc(Document doc) {
        var result = new ExtrusionSnapshot { Source = SnapshotSource.FamilyDoc };

        var extrusions = new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(e => e.Sketch != null)
            .ToList();

        foreach (var extrusion in extrusions) {
            try {
                if (TryBuildRectangleSpec(extrusion, doc, out var rectangle)) {
                    result.Rectangles.Add(rectangle);
                    continue;
                }

                if (TryBuildCircleSpec(extrusion, doc, out var circle))
                    result.Circles.Add(circle);
            } catch {
                // Never fail the full pipeline due to one problematic extrusion.
            }
        }

        return result;
    }

    private static ParamDrivenSolidsSnapshot CollectSemanticSnapshot(
        Document doc,
        ExtrusionSnapshot legacy,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var result = new ParamDrivenSolidsSnapshot { Source = SnapshotSource.FamilyDoc };

        foreach (var rectangle in legacy.Rectangles) {
            var semantic = TryBuildSemanticRectangle(doc, rectangle, refPlanesAndDims);
            if (semantic != null)
                result.Rectangles.Add(semantic);
        }

        foreach (var circle in legacy.Circles) {
            var semantic = TryBuildSemanticCylinder(doc, circle, refPlanesAndDims);
            if (semantic != null)
                result.Cylinders.Add(semantic);
        }

        return result;
    }

    private static ParamDrivenRectangleSpec? TryBuildSemanticRectangle(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        if (!TryClassifyRectanglePairs(doc, spec, out var widthPair, out var lengthPair))
            return null;

        var width = BuildAxisConstraint(doc, widthPair, refPlanesAndDims, AxisSemanticRole.Width, spec.Name, "Width");
        var length = BuildAxisConstraint(doc, lengthPair, refPlanesAndDims, AxisSemanticRole.Length, spec.Name, "Length");
        var height = BuildHeightConstraint(doc, spec, refPlanesAndDims);

        return new ParamDrivenRectangleSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            Sketch = new SketchTargetSpec { Kind = SketchTargetKind.ReferencePlane, Plane = spec.SketchPlaneName },
            Width = width,
            Length = length,
            Height = height
        };
    }

    private static ParamDrivenCylinderSpec? TryBuildSemanticCylinder(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var pairA = new NamedPlanePair(spec.PairAPlane1, spec.PairAPlane2, spec.PairAParameter);
        var pairB = new NamedPlanePair(spec.PairBPlane1, spec.PairBPlane2, spec.PairBParameter);

        var diameterA = BuildAxisConstraint(doc, pairA, refPlanesAndDims, AxisSemanticRole.Length, spec.Name, "Diameter");
        var diameterB = BuildAxisConstraint(doc, pairB, refPlanesAndDims, AxisSemanticRole.Width, spec.Name, "Diameter");
        var height = BuildHeightConstraint(doc, spec, refPlanesAndDims);

        var centerLeftRightAnchor = diameterA.Mode == AxisConstraintMode.Mirror
            ? diameterA.CenterAnchor
            : string.Empty;
        var centerFrontBackAnchor = diameterB.Mode == AxisConstraintMode.Mirror
            ? diameterB.CenterAnchor
            : string.Empty;

        var diameterWarnings = new List<string>();
        var diameterStatus = InferenceStatus.Exact;

        if (!string.Equals(diameterA.Parameter, diameterB.Parameter, StringComparison.Ordinal)) {
            diameterWarnings.Add("Diameter parameters differed across the two in-plane circle constraints.");
            diameterStatus = InferenceStatus.Ambiguous;
        }

        if (diameterA.Mode != AxisConstraintMode.Mirror || diameterB.Mode != AxisConstraintMode.Mirror) {
            diameterWarnings.Add("Cylinder diameter was inferred from non-mirror constraints.");
            diameterStatus = InferenceStatus.Ambiguous;
        }

        var diameter = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = string.Equals(diameterA.Parameter, diameterB.Parameter, StringComparison.Ordinal)
                ? diameterA.Parameter
                : diameterA.Parameter,
            PlaneNameBase = ExtractSharedDiameterBase(diameterA.PlaneNameBase, diameterB.PlaneNameBase),
            Strength = diameterA.Strength,
            Inference = new InferenceInfo {
                Status = diameterWarnings.Count == 0 ? InferenceStatus.Exact : diameterStatus,
                Warnings = diameterWarnings
            }
        };

        return new ParamDrivenCylinderSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            Sketch = new SketchTargetSpec { Kind = SketchTargetKind.ReferencePlane, Plane = spec.SketchPlaneName },
            CenterLeftRightAnchor = centerLeftRightAnchor,
            CenterFrontBackAnchor = centerFrontBackAnchor,
            Diameter = diameter,
            Height = height
        };
    }

    private static AxisConstraintSpec BuildHeightConstraint(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var pair = new NamedPlanePair(spec.HeightPlaneBottom, spec.HeightPlaneTop, spec.HeightParameter);
        return BuildAxisConstraint(doc, pair, refPlanesAndDims, AxisSemanticRole.Height, spec.Name, "Height");
    }

    private static AxisConstraintSpec BuildHeightConstraint(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var pair = new NamedPlanePair(spec.HeightPlaneBottom, spec.HeightPlaneTop, spec.HeightParameter);
        return BuildAxisConstraint(doc, pair, refPlanesAndDims, AxisSemanticRole.Height, spec.Name, "Height");
    }

    private static AxisConstraintSpec BuildAxisConstraint(
        Document doc,
        NamedPlanePair pair,
        RefPlaneSnapshot? refPlanesAndDims,
        AxisSemanticRole role,
        string solidName,
        string axisName
    ) {
        if (pair.IsEmpty) {
            return new AxisConstraintSpec {
                Mode = AxisConstraintMode.Offset,
                PlaneNameBase = SynthesizePlaneNameBase(role),
                Inference = new InferenceInfo {
                    Status = InferenceStatus.Ambiguous,
                    Warnings = ["Constraint pair could not be resolved from the family."]
                }
            };
        }

        var mirrorMatch = TryMatchMirrorSpec(doc, pair, refPlanesAndDims?.MirrorSpecs ?? []);
        if (mirrorMatch != null) {
            return new AxisConstraintSpec {
                Mode = AxisConstraintMode.Mirror,
                Parameter = pair.Parameter,
                CenterAnchor = mirrorMatch.CenterAnchor,
                PlaneNameBase = mirrorMatch.Name,
                Strength = mirrorMatch.Strength,
                Inference = new InferenceInfo { Status = InferenceStatus.Exact }
            };
        }

        var offsetMatch = TryMatchOffsetSpec(pair, refPlanesAndDims?.OffsetSpecs ?? []);
        if (offsetMatch != null) {
            return new AxisConstraintSpec {
                Mode = AxisConstraintMode.Offset,
                Parameter = pair.Parameter,
                Anchor = offsetMatch.AnchorName,
                Direction = offsetMatch.Direction,
                PlaneNameBase = offsetMatch.Name,
                Strength = offsetMatch.Strength,
                Inference = new InferenceInfo { Status = InferenceStatus.Exact }
            };
        }

        var (negativeLabel, positiveLabel) = GetRoleLabels(role);
        var warnings = new List<string> {
            $"Exact {axisName} semantics could not be reconstructed from RefPlanesAndDims."
        };

        return new AxisConstraintSpec {
            Mode = AxisConstraintMode.Offset,
            Parameter = pair.Parameter,
            Anchor = pair.Plane1 ?? string.Empty,
            Direction = OffsetDirection.Positive,
            PlaneNameBase = pair.Plane2 ?? SynthesizePlaneNameBase(role),
            Strength = InferStrength(doc, pair.Plane2) ?? RpStrength.NotARef,
            Inference = new InferenceInfo {
                Status = InferenceStatus.Inferred,
                Warnings = [
                    .. warnings,
                    $"{negativeLabel} was inferred from '{pair.Plane1 ?? "(missing)"}' and {positiveLabel} from '{pair.Plane2 ?? "(missing)"}'."
                ]
            }
        };
    }

    private static bool TryClassifyRectanglePairs(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        out NamedPlanePair widthPair,
        out NamedPlanePair lengthPair
    ) {
        var pairA = new NamedPlanePair(spec.PairAPlane1, spec.PairAPlane2, spec.PairAParameter);
        var pairB = new NamedPlanePair(spec.PairBPlane1, spec.PairBPlane2, spec.PairBParameter);
        var axisA = ClassifyPairAxis(doc, pairA);
        var axisB = ClassifyPairAxis(doc, pairB);

        widthPair = default;
        lengthPair = default;

        if (axisA == AxisSemanticRole.Width)
            widthPair = pairA;
        else if (axisA == AxisSemanticRole.Length)
            lengthPair = pairA;

        if (axisB == AxisSemanticRole.Width)
            widthPair = pairB;
        else if (axisB == AxisSemanticRole.Length)
            lengthPair = pairB;

        if (!widthPair.IsEmpty && !lengthPair.IsEmpty)
            return true;

        widthPair = pairA;
        lengthPair = pairB;
        return true;
    }

    private static AxisSemanticRole ClassifyPairAxis(Document doc, NamedPlanePair pair) {
        var plane = ResolveReferencePlane(doc, pair.Plane1) ?? ResolveReferencePlane(doc, pair.Plane2);
        if (plane == null)
            return InferAxisRoleFromNames(pair.Plane1, pair.Plane2);

        var normal = plane.Normal.Normalize();
        var x = Math.Abs(normal.X);
        var y = Math.Abs(normal.Y);
        var z = Math.Abs(normal.Z);

        if (z > x && z > y)
            return AxisSemanticRole.Height;

        return x >= y
            ? AxisSemanticRole.Length
            : AxisSemanticRole.Width;
    }

    private static AxisSemanticRole InferAxisRoleFromNames(string? plane1, string? plane2) {
        var names = $"{plane1} {plane2}";
        if (names.Contains("Left", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Right", StringComparison.OrdinalIgnoreCase))
            return AxisSemanticRole.Length;

        if (names.Contains("Front", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Back", StringComparison.OrdinalIgnoreCase))
            return AxisSemanticRole.Width;

        if (names.Contains("Top", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Bottom", StringComparison.OrdinalIgnoreCase))
            return AxisSemanticRole.Height;

        return AxisSemanticRole.Width;
    }

    private static MirrorSpec? TryMatchMirrorSpec(Document doc, NamedPlanePair pair, IReadOnlyList<MirrorSpec> mirrorSpecs) {
        foreach (var spec in mirrorSpecs) {
            var center = ResolveReferencePlane(doc, spec.CenterAnchor);
            if (center == null)
                continue;

            var leftName = spec.GetLeftName(center.Normal.Normalize());
            var rightName = spec.GetRightName(center.Normal.Normalize());
            var pairNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                pair.Plane1 ?? string.Empty, pair.Plane2 ?? string.Empty
            };
            if (pairNames.SetEquals(new[] { leftName, rightName }))
                return spec;
        }

        return null;
    }

    private static OffsetSpec? TryMatchOffsetSpec(NamedPlanePair pair, IReadOnlyList<OffsetSpec> offsetSpecs) {
        foreach (var spec in offsetSpecs) {
            var pairNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
                pair.Plane1 ?? string.Empty, pair.Plane2 ?? string.Empty
            };
            if (pairNames.SetEquals(new[] { spec.AnchorName, spec.Name }))
                return spec;
        }

        return null;
    }

    private static RpStrength? InferStrength(Document doc, string? planeName) =>
        ResolveReferencePlane(doc, planeName)?.get_Parameter(BuiltInParameter.ELEM_REFERENCE_NAME)?.AsInteger() is int value
            ? (RpStrength)value
            : null;

    private static ReferencePlane? ResolveReferencePlane(Document doc, string? planeName) {
        if (string.IsNullOrWhiteSpace(planeName))
            return null;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, planeName, StringComparison.OrdinalIgnoreCase));
    }

    private static string ExtractSharedDiameterBase(string baseA, string baseB) {
        var cleanedA = baseA.Replace(" lr", string.Empty, StringComparison.OrdinalIgnoreCase).Trim();
        var cleanedB = baseB.Replace(" fb", string.Empty, StringComparison.OrdinalIgnoreCase).Trim();
        return string.Equals(cleanedA, cleanedB, StringComparison.OrdinalIgnoreCase)
            ? cleanedA
            : cleanedA;
    }

    private static string SynthesizePlaneNameBase(AxisSemanticRole role) =>
        role switch {
            AxisSemanticRole.Width => "width",
            AxisSemanticRole.Length => "length",
            AxisSemanticRole.Height => "height",
            _ => "plane"
        };

    private static (string Negative, string Positive) GetRoleLabels(AxisSemanticRole role) =>
        role switch {
            AxisSemanticRole.Width => ("Back", "Front"),
            AxisSemanticRole.Length => ("Left", "Right"),
            AxisSemanticRole.Height => ("Bottom", "Top"),
            _ => ("Negative", "Positive")
        };

    private static bool TryBuildRectangleSpec(
        Extrusion extrusion,
        Document doc,
        out ConstrainedRectangleExtrusionSpec spec
    ) {
        spec = null!;
        if (!IsRectangleProfile(extrusion.Sketch.Profile))
            return false;

        if (!TryGetProfilePlanePairs(doc, extrusion, out var pairA, out var pairB))
            return false;

        var height = TryGetHeightConstraintPair(doc, extrusion, out var heightPair) ? heightPair : default;

        spec = new ConstrainedRectangleExtrusionSpec {
            Name = GetExtrusionName(extrusion),
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            SketchPlaneName = extrusion.Sketch.SketchPlane?.Name ?? string.Empty,
            PairAPlane1 = pairA.Plane1.Name,
            PairAPlane2 = pairA.Plane2.Name,
            PairAParameter = pairA.ParameterName,
            PairBPlane1 = pairB.Plane1.Name,
            PairBPlane2 = pairB.Plane2.Name,
            PairBParameter = pairB.ParameterName,
            HeightPlaneBottom = height.Plane1?.Name,
            HeightPlaneTop = height.Plane2?.Name,
            HeightParameter = height.ParameterName
        };
        return true;
    }

    private static bool TryBuildCircleSpec(
        Extrusion extrusion,
        Document doc,
        out ConstrainedCircleExtrusionSpec spec
    ) {
        spec = null!;
        if (!IsCircleProfile(extrusion.Sketch.Profile))
            return false;

        if (!TryGetProfilePlanePairs(doc, extrusion, out var pairA, out var pairB))
            return false;

        var height = TryGetHeightConstraintPair(doc, extrusion, out var heightPair) ? heightPair : default;

        spec = new ConstrainedCircleExtrusionSpec {
            Name = GetExtrusionName(extrusion),
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            SketchPlaneName = extrusion.Sketch.SketchPlane?.Name ?? string.Empty,
            PairAPlane1 = pairA.Plane1.Name,
            PairAPlane2 = pairA.Plane2.Name,
            PairAParameter = pairA.ParameterName,
            PairBPlane1 = pairB.Plane1.Name,
            PairBPlane2 = pairB.Plane2.Name,
            PairBParameter = pairB.ParameterName,
            HeightPlaneBottom = height.Plane1?.Name,
            HeightPlaneTop = height.Plane2?.Name,
            HeightParameter = height.ParameterName
        };
        return true;
    }

    private static bool TryGetProfilePlanePairs(
        Document doc,
        Extrusion extrusion,
        out DimConstraint pairA,
        out DimConstraint pairB
    ) {
        pairA = default;
        pairB = default;

        var profilePlanes = GetProfileReferencePlanes(doc, extrusion);
        if (profilePlanes.Count < 4)
            return false;

        var grouped = profilePlanes
            .GroupBy(plane => GetParallelPlaneGroupKey(plane.Normal.Normalize()))
            .Where(group => group.Count() >= 2)
            .Take(2)
            .ToList();
        if (grouped.Count < 2)
            return false;

        var groupA = grouped[0].Take(2).ToList();
        var groupB = grouped[1].Take(2).ToList();
        var parameterA = FindDimensionLabel(doc, groupA[0], groupA[1]);
        var parameterB = FindDimensionLabel(doc, groupB[0], groupB[1]);

        pairA = new DimConstraint(groupA[0], groupA[1], parameterA);
        pairB = new DimConstraint(groupB[0], groupB[1], parameterB);
        return true;
    }

    private static bool TryGetHeightConstraintPair(
        Document doc,
        Extrusion extrusion,
        out DimConstraint pair
    ) {
        pair = default;
        var sketchPlane = extrusion.Sketch.SketchPlane;
        if (sketchPlane == null)
            return false;

        var sketch = sketchPlane.GetPlane();
        var normal = sketch.Normal.Normalize();

        var candidates = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .Where(plane => Math.Abs(Math.Abs(plane.Normal.Normalize().DotProduct(normal)) - 1.0) <= 1e-3)
            .Select(plane => new {
                Plane = plane,
                Distance = SignedDistanceToPlaneAlongNormal(plane.BubbleEnd, sketch.Origin, normal)
            })
            .ToList();

        var bottom = candidates
            .OrderBy(candidate => Math.Abs(candidate.Distance - extrusion.StartOffset))
            .FirstOrDefault(candidate => Math.Abs(candidate.Distance - extrusion.StartOffset) <= DistanceTolerance);
        var top = candidates
            .OrderBy(candidate => Math.Abs(candidate.Distance - extrusion.EndOffset))
            .FirstOrDefault(candidate => Math.Abs(candidate.Distance - extrusion.EndOffset) <= DistanceTolerance);

        if (bottom?.Plane == null || top?.Plane == null || bottom.Plane.Id == top.Plane.Id)
            return false;

        pair = new DimConstraint(
            bottom.Plane,
            top.Plane,
            FindDimensionLabel(doc, bottom.Plane, top.Plane));
        return true;
    }

    private static List<ReferencePlane> GetProfileReferencePlanes(Document doc, Extrusion extrusion) {
        var planes = new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .Where(plane => !string.IsNullOrWhiteSpace(plane.Name))
            .ToList();

        var matched = new Dictionary<ElementId, ReferencePlane>();
        var sketchNormal = extrusion.Sketch.SketchPlane?.GetPlane()?.Normal.Normalize();

        foreach (var loop in extrusion.Sketch.Profile.Cast<CurveArray>()) {
            foreach (var curve in loop.Cast<Curve>()) {
                if (curve is Line line) {
                    var p0 = line.GetEndPoint(0);
                    var p1 = line.GetEndPoint(1);
                    var plane = planes.FirstOrDefault(candidate =>
                        IsPointOnPlane(p0, candidate) && IsPointOnPlane(p1, candidate));
                    if (plane == null)
                        continue;

                    matched[plane.Id] = plane;
                    continue;
                }

                if (curve is not Arc arc || sketchNormal == null)
                    continue;

                foreach (var plane in planes.Where(candidate =>
                             Math.Abs(candidate.Normal.Normalize().DotProduct(sketchNormal)) <= DotOrthoTolerance)) {
                    var distance = Math.Abs((arc.Center - plane.BubbleEnd).DotProduct(plane.Normal.Normalize()));
                    if (Math.Abs(distance - arc.Radius) > DistanceTolerance)
                        continue;

                    matched[plane.Id] = plane;
                }
            }
        }

        return matched.Values.ToList();
    }

    private static string FindDimensionLabel(Document doc, ReferencePlane plane1, ReferencePlane plane2) {
        var targetIds = new HashSet<ElementId> { plane1.Id, plane2.Id };

        foreach (var dim in new FilteredElementCollector(doc).OfClass(typeof(Dimension)).Cast<Dimension>()) {
            if (dim.References.Size != 2)
                continue;

            FamilyParameter? familyLabel = null;
            try {
                familyLabel = dim.FamilyLabel;
            } catch {
                continue;
            }

            if (familyLabel?.Definition?.Name is not { Length: > 0 } labelName)
                continue;

            var dimIds = new HashSet<ElementId>();
            for (var i = 0; i < dim.References.Size; i++) {
                if (doc.GetElement(dim.References.get_Item(i)) is ReferencePlane plane)
                    _ = dimIds.Add(plane.Id);
            }

            if (dimIds.SetEquals(targetIds))
                return labelName;
        }

        return string.Empty;
    }

    private static bool IsRectangleProfile(CurveArrArray profile) {
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        if (loop == null || loop.Size != 4)
            return false;

        var lines = loop.Cast<Curve>().Select(c => c as Line).ToList();
        if (lines.Any(line => line == null))
            return false;

        var dirs = lines.Select(line => (line!.GetEndPoint(1) - line.GetEndPoint(0)).Normalize()).ToList();
        for (var i = 0; i < dirs.Count; i++) {
            var next = (i + 1) % dirs.Count;
            var dot = Math.Abs(dirs[i].DotProduct(dirs[next]));
            if (dot > DotOrthoTolerance)
                return false;
        }

        return true;
    }

    private static bool IsCircleProfile(CurveArrArray profile) {
        if (profile == null || profile.Size != 1)
            return false;

        var loop = profile.get_Item(0);
        if (loop == null || loop.Size == 0)
            return false;

        var arcs = loop.Cast<Curve>().Select(c => c as Arc).ToList();
        if (arcs.Any(arc => arc == null))
            return false;

        var center = arcs[0]!.Center;
        var radius = arcs[0].Radius;
        const double tolerance = 1e-6;
        return arcs.All(arc => arc!.Center.IsAlmostEqualTo(center, tolerance) && Math.Abs(arc.Radius - radius) <= tolerance);
    }

    private static string GetExtrusionName(Extrusion extrusion) =>
        string.IsNullOrWhiteSpace(extrusion.Name)
            ? $"Extrusion_{extrusion.Id.Value()}"
            : extrusion.Name;

    private static string GetParallelPlaneGroupKey(XYZ normal) {
        var normalized = normal.Normalize();
        if (normalized.Z < 0 ||
            (Math.Abs(normalized.Z) <= PlaneTolerance && normalized.Y < 0) ||
            (Math.Abs(normalized.Z) <= PlaneTolerance && Math.Abs(normalized.Y) <= PlaneTolerance && normalized.X < 0)) {
            normalized = normalized.Negate();
        }

        return $"{Math.Round(normalized.X, 3)}|{Math.Round(normalized.Y, 3)}|{Math.Round(normalized.Z, 3)}";
    }

    private static bool IsPointOnPlane(XYZ point, ReferencePlane plane) {
        var signed = (point - plane.BubbleEnd).DotProduct(plane.Normal);
        return Math.Abs(signed) <= PlaneTolerance;
    }

    private static double SignedDistanceToPlaneAlongNormal(XYZ point, XYZ planeOrigin, XYZ normalizedPlaneNormal) =>
        (point - planeOrigin).DotProduct(normalizedPlaneNormal);

    private readonly record struct DimConstraint(
        ReferencePlane Plane1,
        ReferencePlane Plane2,
        string ParameterName
    );

    private readonly record struct NamedPlanePair(string? Plane1, string? Plane2, string? Parameter) {
        public bool IsEmpty => string.IsNullOrWhiteSpace(this.Plane1) || string.IsNullOrWhiteSpace(this.Plane2);
    }

    private enum AxisSemanticRole {
        Width,
        Length,
        Height
    }
}
