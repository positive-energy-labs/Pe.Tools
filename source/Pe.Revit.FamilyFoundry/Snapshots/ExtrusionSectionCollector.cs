using Pe.Revit.Extensions.FamDocument;
using Pe.FamilyFoundry.Aggregators.Snapshots;
using Pe.FamilyFoundry.Helpers;
using Pe.FamilyFoundry.Resolution;
using Serilog;
using Pe.FamilyFoundry.Operations;
using System.Text.RegularExpressions;
using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;

using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Collects authored ParamDrivenSolids snapshots.
///     Legacy decompilation helpers remain private to this collector only.
/// </summary>
public partial class ExtrusionSectionCollector : IFamilyDocCollector {
    private const double AuthoredOffsetTolerance = 1e-6;
    private const string DefaultInferredConnectorDepth = "0.5in";
    private const double DotOrthoTolerance = 0.15;
    private const double PlaneTolerance = 1e-6;
    private const double DistanceTolerance = 1e-4;
    private static readonly IReadOnlyDictionary<string, string> BuiltInPlaneRefs =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
            ["Left"] = "@Left",
            ["Right"] = "@Right",
            ["Front"] = "@Front",
            ["Back"] = "@Back",
            ["Top"] = "@Top",
            ["Reference Plane"] = "@Bottom",
            ["Ref. Level"] = "@Bottom",
            ["Reference Level"] = "@Bottom",
            ["Level"] = "@Bottom",
            ["Lower Ref. Level"] = "@Bottom",
            ["Lower Reference Level"] = "@Bottom",
            ["Center (Left/Right)"] = "@CenterLR",
            ["CenterLR"] = "@CenterLR",
            ["Center (Front/Back)"] = "@CenterFB",
            ["CenterFB"] = "@CenterFB"
        };

    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.ParamDrivenSolids == null || !snapshot.ParamDrivenSolids.HasContent;

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        var legacy = CollectLegacyFromFamilyDoc(famDoc.Document, snapshot.RefPlanesAndDims);
        var authoredSnapshot = CollectAuthoredSnapshot(
            famDoc.Document,
            legacy,
            snapshot.RefPlanesAndDims);
        snapshot.ParamDrivenSolids = authoredSnapshot;
        snapshot.RefPlanesAndDims = RemoveInternalAuthoredConstraints(
            snapshot.RefPlanesAndDims,
            snapshot.ParamDrivenSolids);
    }

    private static ExtrusionSnapshot CollectLegacyFromFamilyDoc(Document doc, RefPlaneSnapshot? refPlanesAndDims) {
        var result = new ExtrusionSnapshot { Source = SnapshotSource.FamilyDoc };
        var ownedStubIds = RawConnectorUnitInference.MatchOwnedStubs(doc)
            .Values
            .Select(match => match.Extrusion.Id)
            .ToHashSet();

        var extrusions = new FilteredElementCollector(doc)
            .OfClass(typeof(Extrusion))
            .Cast<Extrusion>()
            .Where(e => e.Sketch != null)
            .ToList();

        foreach (var extrusion in extrusions) {
            try {
                if (ownedStubIds.Contains(extrusion.Id))
                    continue;

                if (TryBuildRectangleSpec(extrusion, doc, out var rectangle)) {
                    result.Rectangles.Add(rectangle);
                    continue;
                }

                if (TryBuildCircleSpec(extrusion, doc, refPlanesAndDims, out var circle))
                    result.Circles.Add(circle);
            } catch {
                // Never fail the full pipeline due to one problematic extrusion.
            }
        }

        return result;
    }

    private static AuthoredParamDrivenSolidsSettings CollectAuthoredSnapshot(
        Document doc,
        ExtrusionSnapshot legacy,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var result = new AuthoredParamDrivenSolidsSettings {
            Frame = ParamDrivenFamilyFrameKind.NonHosted
        };

        foreach (var rectangle in legacy.Rectangles) {
            if (TryBuildAuthoredPrism(doc, rectangle, refPlanesAndDims, out var prism))
                result.Prisms.Add(prism);
        }

        foreach (var circle in legacy.Circles) {
            if (TryBuildAuthoredCylinder(doc, circle, refPlanesAndDims, out var cylinder))
                result.Cylinders.Add(cylinder);
        }

        var residual = RemoveInternalAuthoredConstraints(refPlanesAndDims, result);
        PromoteResidualAuthoredPlanes(doc, result, residual);
        AddInferredRawConnectors(doc, result);
        return result;
    }

    private static RefPlaneSnapshot? RemoveInternalAuthoredConstraints(
        RefPlaneSnapshot? refPlaneSnapshot,
        AuthoredParamDrivenSolidsSettings authoredSnapshot
    ) {
        if (refPlaneSnapshot == null)
            return null;

        if (!authoredSnapshot.HasContent)
            return refPlaneSnapshot;

        var compiled = AuthoredParamDrivenSolidsCompiler.Compile(authoredSnapshot);
        if (!compiled.CanExecute)
            return refPlaneSnapshot;

        var internalMirrorKeys = compiled.RefPlanesAndDims.SymmetricPairs
            .Select(BuildSymmetricKey)
            .ToHashSet(StringComparer.Ordinal);
        var internalOffsetKeys = compiled.RefPlanesAndDims.Offsets
            .Select(BuildOffsetKey)
            .ToHashSet(StringComparer.Ordinal);

        return new RefPlaneSnapshot {
            Source = refPlaneSnapshot.Source,
            MirrorSpecs = refPlaneSnapshot.MirrorSpecs
                .Where(spec => !internalMirrorKeys.Contains(BuildMirrorKey(spec)))
                .ToList(),
            OffsetSpecs = refPlaneSnapshot.OffsetSpecs
                .Where(spec => !internalOffsetKeys.Contains(BuildOffsetKey(spec)))
                .ToList()
        };
    }

    private static void PromoteResidualAuthoredPlanes(
        Document doc,
        AuthoredParamDrivenSolidsSettings authoredSnapshot,
        RefPlaneSnapshot? refPlaneSnapshot
    ) {
        if (refPlaneSnapshot == null)
            return;

        var usedNames = CollectPublishedPlaneNames(authoredSnapshot);

        foreach (var spec in refPlaneSnapshot.OffsetSpecs) {
            var planeName = BuildResidualAuthoredPlaneName(spec, usedNames);
            if (string.IsNullOrWhiteSpace(planeName))
                planeName = $"Plane {authoredSnapshot.Planes.Count + 1}";

            if (!TryBuildAuthoredPlane(doc, spec.AnchorName, spec.Name, spec.Parameter, spec.Direction, out var authoredPlane))
                continue;

            authoredSnapshot.Planes[planeName] = authoredPlane;
            _ = usedNames.Add(planeName);
        }
    }

    private static string BuildResidualAuthoredPlaneName(OffsetSpec spec, ISet<string> usedNames) {
        var preferredName = IsLowValuePlaneName(spec.Name)
            ? HumanizeIdentifier(spec.Parameter)
            : spec.Name?.Trim();

        if (string.IsNullOrWhiteSpace(preferredName))
            preferredName = HumanizeIdentifier(spec.Name);

        if (string.IsNullOrWhiteSpace(preferredName))
            preferredName = spec.Name?.Trim();

        if (string.IsNullOrWhiteSpace(preferredName))
            return string.Empty;

        if (!usedNames.Contains(preferredName))
            return preferredName;

        for (var suffix = 2; suffix < 1000; suffix++) {
            var candidate = $"{preferredName} {suffix}";
            if (!usedNames.Contains(candidate))
                return candidate;
        }

        return preferredName;
    }

    private static bool IsLowValuePlaneName(string? planeName) {
        if (string.IsNullOrWhiteSpace(planeName))
            return true;

        var trimmed = planeName.Trim();
        if (trimmed.Equals("Reference Plane", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("Ref. Level", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("Center (Left/Right)", StringComparison.OrdinalIgnoreCase) ||
            trimmed.Equals("Center (Front/Back)", StringComparison.OrdinalIgnoreCase))
            return false;

        return Regex.IsMatch(trimmed, @"^Reference Plane(?: \d+)?$", RegexOptions.IgnoreCase) ||
               Regex.IsMatch(trimmed, @"^Ref\. Level(?: \d+)?$", RegexOptions.IgnoreCase) ||
               Regex.IsMatch(trimmed, @"^Center \((Left/Right|Front/Back)\)(?: \d+)?$", RegexOptions.IgnoreCase);
    }

    private static string? HumanizeIdentifier(string? value) {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        var trimmed = value.Trim();
        var expanded = Regex.Replace(trimmed, @"(?<=[a-z0-9])(?=[A-Z])", " ");
        expanded = expanded.Replace('_', ' ').Replace('-', ' ');
        expanded = Regex.Replace(expanded, @"\s+", " ").Trim();
        return string.IsNullOrWhiteSpace(expanded)
            ? null
            : char.ToUpperInvariant(expanded[0]) + expanded[1..];
    }

    private static bool TryBuildAuthoredPrism(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        out AuthoredPrismSpec prism
    ) {
        prism = null!;
        if (!TryClassifyRectanglePairs(doc, spec, out var widthPair, out var lengthPair))
            return false;

        if (!TryBuildAuthoredSpan(doc, widthPair, refPlanesAndDims, SolidAxis.Width, out var width))
            return false;

        if (!TryBuildAuthoredSpan(doc, lengthPair, refPlanesAndDims, SolidAxis.Length, out var length))
            return false;

        var on = ToAuthoredPlaneRef(spec.SketchPlaneName);
        if (!IsValidAuthoredPlaneRef(on))
            return false;

        prism = new AuthoredPrismSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            On = on,
            Width = width,
            Length = length,
            Height = BuildAuthoredHeightSpec(
                doc,
                spec.Name,
                spec.SketchPlaneName,
                spec.HeightPlaneBottom,
                spec.HeightPlaneTop,
                spec.HeightParameter,
                spec.StartOffset,
                spec.EndOffset,
                spec.HeightControlMode,
                refPlanesAndDims)
        };
        return true;
    }

    private static bool TryBuildAuthoredCylinder(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        out AuthoredCylinderSpec cylinder
    ) {
        cylinder = null!;
        var on = ToAuthoredPlaneRef(spec.SketchPlaneName);
        var center1 = ToAuthoredPlaneRef(spec.CenterPlane1);
        var center2 = ToAuthoredPlaneRef(spec.CenterPlane2);
        var diameter = ToAuthoredLength(spec.DiameterParameter);
        if (!IsValidAuthoredPlaneRef(on) ||
            !IsValidAuthoredPlaneRef(center1) ||
            !IsValidAuthoredPlaneRef(center2) ||
            string.IsNullOrWhiteSpace(diameter)) {
            return false;
        }

        cylinder = new AuthoredCylinderSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            On = on,
            Center = [center1, center2],
            Diameter = new AuthoredMeasureSpec { By = diameter },
            Height = BuildAuthoredHeightSpec(
                doc,
                spec.Name,
                spec.SketchPlaneName,
                spec.HeightPlaneBottom,
                spec.HeightPlaneTop,
                spec.HeightParameter,
                spec.StartOffset,
                spec.EndOffset,
                spec.HeightControlMode,
                refPlanesAndDims)
        };
        return true;
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

        if (axisA == SolidAxis.Width)
            widthPair = pairA;
        else if (axisA == SolidAxis.Length)
            lengthPair = pairA;

        if (axisB == SolidAxis.Width)
            widthPair = pairB;
        else if (axisB == SolidAxis.Length)
            lengthPair = pairB;

        if (!widthPair.IsEmpty && !lengthPair.IsEmpty)
            return true;

        widthPair = pairA;
        lengthPair = pairB;
        return true;
    }

    private static SolidAxis ClassifyPairAxis(Document doc, NamedPlanePair pair) {
        var plane = ResolveReferencePlane(doc, pair.Plane1) ?? ResolveReferencePlane(doc, pair.Plane2);
        if (plane == null)
            return InferAxisRoleFromNames(pair.Plane1, pair.Plane2);

        var normal = plane.Normal.Normalize();
        var x = Math.Abs(normal.X);
        var y = Math.Abs(normal.Y);
        var z = Math.Abs(normal.Z);

        if (z > x && z > y)
            return SolidAxis.Height;

        return x >= y
            ? SolidAxis.Length
            : SolidAxis.Width;
    }

    private static SolidAxis InferAxisRoleFromNames(string? plane1, string? plane2) {
        var names = $"{plane1} {plane2}";
        if (names.Contains("Left", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Right", StringComparison.OrdinalIgnoreCase))
            return SolidAxis.Length;

        if (names.Contains("Front", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Back", StringComparison.OrdinalIgnoreCase))
            return SolidAxis.Width;

        if (names.Contains("Top", StringComparison.OrdinalIgnoreCase) ||
            names.Contains("Bottom", StringComparison.OrdinalIgnoreCase))
            return SolidAxis.Height;

        return SolidAxis.Width;
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

    private static ReferencePlane? ResolveReferencePlane(Document doc, string? planeName) {
        if (string.IsNullOrWhiteSpace(planeName))
            return null;

        return new FilteredElementCollector(doc)
            .OfClass(typeof(ReferencePlane))
            .Cast<ReferencePlane>()
            .FirstOrDefault(plane => string.Equals(plane.Name, planeName, StringComparison.OrdinalIgnoreCase));
    }

    private static bool TryBuildAuthoredSpan(
        Document doc,
        NamedPlanePair pair,
        RefPlaneSnapshot? refPlanesAndDims,
        SolidAxis axis,
        out PlanePairOrInlineSpanSpec span
    ) {
        span = null!;
        if (pair.IsEmpty)
            return false;

        if (TryBuildInlineSpan(doc, pair, refPlanesAndDims, axis, out var inlineSpan)) {
            span = new PlanePairOrInlineSpanSpec { InlineSpan = inlineSpan };
            return true;
        }

        var refs = new[] { ToAuthoredPlaneRef(pair.Plane1), ToAuthoredPlaneRef(pair.Plane2) }
            .Where(IsValidAuthoredPlaneRef)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        if (refs.Count != 2)
            return false;

        span = new PlanePairOrInlineSpanSpec { PlaneRefs = refs };
        return true;
    }

    private static bool TryBuildInlineSpan(
        Document doc,
        NamedPlanePair pair,
        RefPlaneSnapshot? refPlanesAndDims,
        SolidAxis axis,
        out AuthoredSpanSpec span
    ) {
        span = null!;
        if (!TryBuildPairMeasure(doc, pair, out var by))
            return false;

        if (!TryResolveSpanCenterPlane(doc, pair, refPlanesAndDims, axis, out var aboutPlaneName, out var negativePlaneName, out var positivePlaneName))
            return false;

        var about = ToAuthoredPlaneRef(aboutPlaneName);
        if (!IsValidAuthoredPlaneRef(about))
            return false;

        span = new AuthoredSpanSpec {
            About = about,
            By = by,
            Negative = negativePlaneName,
            Positive = positivePlaneName
        };
        return true;
    }

    private static bool TryResolveSpanCenterPlane(
        Document doc,
        NamedPlanePair pair,
        RefPlaneSnapshot? refPlanesAndDims,
        SolidAxis axis,
        out string centerPlaneName,
        out string negativePlaneName,
        out string positivePlaneName
    ) {
        centerPlaneName = string.Empty;
        negativePlaneName = string.Empty;
        positivePlaneName = string.Empty;

        var mirrorMatch = TryMatchMirrorSpec(doc, pair, refPlanesAndDims?.MirrorSpecs ?? []);
        if (mirrorMatch != null &&
            TryOrderPairRelativeToCenter(doc, pair, mirrorMatch.CenterAnchor, out negativePlaneName, out positivePlaneName)) {
            centerPlaneName = mirrorMatch.CenterAnchor;
            return true;
        }

        foreach (var candidate in GetBuiltInCenterPlaneCandidates(axis)) {
            if (TryOrderPairRelativeToCenter(doc, pair, candidate, out negativePlaneName, out positivePlaneName)) {
                centerPlaneName = candidate;
                return true;
            }
        }

        return false;
    }

    private static IEnumerable<string> GetBuiltInCenterPlaneCandidates(SolidAxis axis) =>
        axis switch {
            SolidAxis.Width => ["Center (Front/Back)", "CenterFB"],
            SolidAxis.Length => ["Center (Left/Right)", "CenterLR"],
            SolidAxis.Height => ["Reference Plane", "Ref. Level", "Reference Level", "Level"],
            _ => []
        };

    private static bool TryOrderPairRelativeToCenter(
        Document doc,
        NamedPlanePair pair,
        string centerPlaneName,
        out string negativePlaneName,
        out string positivePlaneName
    ) {
        negativePlaneName = string.Empty;
        positivePlaneName = string.Empty;

        var centerPlane = ResolveReferencePlane(doc, centerPlaneName);
        var plane1 = ResolveReferencePlane(doc, pair.Plane1);
        var plane2 = ResolveReferencePlane(doc, pair.Plane2);
        if (centerPlane == null || plane1 == null || plane2 == null)
            return false;

        var signed1 = SignedDistanceToPlane(plane1.BubbleEnd, centerPlane);
        var signed2 = SignedDistanceToPlane(plane2.BubbleEnd, centerPlane);
        if (Math.Abs(signed1) <= DistanceTolerance || Math.Abs(signed2) <= DistanceTolerance)
            return false;

        if (Math.Sign(signed1) == Math.Sign(signed2))
            return false;

        negativePlaneName = signed1 < 0.0 ? plane1.Name : plane2.Name;
        positivePlaneName = signed1 < 0.0 ? plane2.Name : plane1.Name;
        return true;
    }

    private static bool TryBuildPairMeasure(Document doc, NamedPlanePair pair, out string by) {
        by = ToAuthoredLength(pair.Parameter);
        if (!string.IsNullOrWhiteSpace(by))
            return true;

        if (!TryMeasurePlanePairDistance(doc, pair.Plane1, pair.Plane2, out var distance))
            return false;

        by = ToAuthoredLiteral(distance);
        return true;
    }

    private static PlaneRefOrInlinePlaneSpec BuildAuthoredHeightSpec(
        Document doc,
        string ownerName,
        string sketchPlaneName,
        string? bottomPlaneName,
        string? topPlaneName,
        string? parameterName,
        double startOffset,
        double endOffset,
        ExtrusionHeightControlMode heightControlMode,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var pair = new NamedPlanePair(bottomPlaneName, topPlaneName, parameterName);
        if (!pair.IsEmpty &&
            TryBuildInlineHeightPlane(doc, pair, ownerName, sketchPlaneName, refPlanesAndDims, out var inlineHeightPlane)) {
            return inlineHeightPlane;
        }

        if (heightControlMode == ExtrusionHeightControlMode.EndOffset &&
            TryBuildLiteralHeightFallback(startOffset, endOffset, out var endOffsetPlane)) {
            return endOffsetPlane;
        }

        if (!pair.IsEmpty &&
            TryBuildBestEffortInlineHeightPlane(doc, pair, ownerName, sketchPlaneName, out var fallbackInlinePlane)) {
            return fallbackInlinePlane;
        }

        return new PlaneRefOrInlinePlaneSpec {
            EndOffset = new AuthoredEndOffsetPlaneSpec {
                By = ToAuthoredLiteral(Math.Abs(endOffset - startOffset)),
                Dir = endOffset >= startOffset ? "out" : "in"
            }
        };
    }

    private static bool TryBuildInlineHeightPlane(
        Document doc,
        NamedPlanePair pair,
        string ownerName,
        string sketchPlaneName,
        RefPlaneSnapshot? refPlanesAndDims,
        out PlaneRefOrInlinePlaneSpec height
    ) {
        height = null!;
        var offsetMatch = TryMatchOffsetSpec(pair, refPlanesAndDims?.OffsetSpecs ?? []);
        var anchorPlaneName = offsetMatch?.AnchorName ?? pair.Plane1 ?? sketchPlaneName;
        var direction = offsetMatch?.Direction ?? InferOffsetDirection(doc, anchorPlaneName, pair.Plane2);
        if (!TryBuildAuthoredPlane(doc, anchorPlaneName, pair.Plane2, pair.Parameter, direction, out var plane))
            return false;

        height = new PlaneRefOrInlinePlaneSpec {
            InlinePlane = new AuthoredNamedPlaneSpec {
                Name = NormalizePublishedPlaneName(pair.Plane2, $"{ownerName} Top"),
                From = plane.From,
                By = plane.By,
                Dir = plane.Dir
            }
        };
        return true;
    }

    private static bool TryBuildBestEffortInlineHeightPlane(
        Document doc,
        NamedPlanePair pair,
        string ownerName,
        string sketchPlaneName,
        out PlaneRefOrInlinePlaneSpec height
    ) {
        height = null!;
        var anchorPlaneName = pair.Plane1 ?? sketchPlaneName;
        var direction = InferOffsetDirection(doc, anchorPlaneName, pair.Plane2);
        if (!TryBuildAuthoredPlane(doc, anchorPlaneName, pair.Plane2, pair.Parameter, direction, out var plane))
            return false;

        height = new PlaneRefOrInlinePlaneSpec {
            InlinePlane = new AuthoredNamedPlaneSpec {
                Name = NormalizePublishedPlaneName(pair.Plane2, $"{ownerName} Top"),
                From = plane.From,
                By = plane.By,
                Dir = plane.Dir
            }
        };
        return true;
    }

    private static bool TryBuildLiteralHeightFallback(
        double startOffset,
        double endOffset,
        out PlaneRefOrInlinePlaneSpec height
    ) {
        height = null!;
        if (Math.Abs(startOffset) > AuthoredOffsetTolerance)
            return false;

        var value = Math.Abs(endOffset - startOffset);
        if (value <= AuthoredOffsetTolerance)
            return false;

        height = new PlaneRefOrInlinePlaneSpec {
            EndOffset = new AuthoredEndOffsetPlaneSpec {
                By = ToAuthoredLiteral(value),
                Dir = endOffset >= startOffset ? "out" : "in"
            }
        };
        return true;
    }

    private static bool TryBuildAuthoredPlane(
        Document doc,
        string? anchorPlaneName,
        string? targetPlaneName,
        string? parameterName,
        OffsetDirection direction,
        out AuthoredPlaneSpec plane
    ) {
        plane = null!;
        var from = ToAuthoredPlaneRef(anchorPlaneName);
        if (!IsValidAuthoredPlaneRef(from))
            return false;

        var by = ToAuthoredLength(parameterName);
        double literalDistance = 0.0;
        if (string.IsNullOrWhiteSpace(by) &&
            !TryMeasurePlanePairDistance(doc, anchorPlaneName, targetPlaneName, out literalDistance)) {
            return false;
        }

        plane = new AuthoredPlaneSpec {
            From = from,
            By = string.IsNullOrWhiteSpace(by) ? ToAuthoredLiteral(literalDistance) : by,
            Dir = ToAuthoredDirection(direction)
        };
        return true;
    }

    private static bool TryMeasurePlanePairDistance(
        Document doc,
        string? firstPlaneName,
        string? secondPlaneName,
        out double distance
    ) {
        distance = 0.0;
        var firstPlane = ResolveReferencePlane(doc, firstPlaneName);
        var secondPlane = ResolveReferencePlane(doc, secondPlaneName);
        if (firstPlane == null || secondPlane == null)
            return false;

        distance = Math.Abs(SignedDistanceToPlane(secondPlane.BubbleEnd, firstPlane));
        return distance > AuthoredOffsetTolerance;
    }

    private static OffsetDirection InferOffsetDirection(
        Document doc,
        string? anchorPlaneName,
        string? targetPlaneName
    ) {
        var anchor = ResolveReferencePlane(doc, anchorPlaneName);
        var target = ResolveReferencePlane(doc, targetPlaneName);
        if (anchor == null || target == null)
            return OffsetDirection.Positive;

        return SignedDistanceToPlane(target.BubbleEnd, anchor) < 0.0
            ? OffsetDirection.Negative
            : OffsetDirection.Positive;
    }

    private static string NormalizePublishedPlaneName(string? planeName, string fallbackName) =>
        string.IsNullOrWhiteSpace(planeName)
            ? fallbackName
            : planeName.Trim();

    private static HashSet<string> CollectPublishedPlaneNames(AuthoredParamDrivenSolidsSettings authoredSnapshot) {
        var names = authoredSnapshot.Planes.Keys
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var span in authoredSnapshot.Spans) {
            if (!string.IsNullOrWhiteSpace(span.Negative))
                _ = names.Add(span.Negative.Trim());
            if (!string.IsNullOrWhiteSpace(span.Positive))
                _ = names.Add(span.Positive.Trim());
        }

        foreach (var prism in authoredSnapshot.Prisms) {
            if (prism.Height.InlinePlane?.Name is { Length: > 0 } prismHeightPlane)
                _ = names.Add(prismHeightPlane.Trim());

            if (prism.Width.InlineSpan != null) {
                _ = names.Add(prism.Width.InlineSpan.Negative.Trim());
                _ = names.Add(prism.Width.InlineSpan.Positive.Trim());
            }

            if (prism.Length.InlineSpan != null) {
                _ = names.Add(prism.Length.InlineSpan.Negative.Trim());
                _ = names.Add(prism.Length.InlineSpan.Positive.Trim());
            }
        }

        foreach (var cylinder in authoredSnapshot.Cylinders)
            if (cylinder.Height.InlinePlane?.Name is { Length: > 0 } cylinderHeightPlane)
                _ = names.Add(cylinderHeightPlane.Trim());

        return names;
    }

    private static string ToAuthoredPlaneRef(string? planeName) =>
        BuiltInPlaneRefs.TryGetValue(planeName?.Trim() ?? string.Empty, out var builtInRef)
            ? builtInRef
            : $"plane:{planeName?.Trim()}";

    private static string ToAuthoredDirection(OffsetDirection direction) =>
        direction == OffsetDirection.Negative ? "in" : "out";

    private static string ToAuthoredLength(string? parameterName) =>
        string.IsNullOrWhiteSpace(parameterName)
            ? string.Empty
            : $"param:{parameterName.Trim()}";

    private static string ToAuthoredLiteral(double internalFeet) =>
        $"{internalFeet.ToString("0.###############", System.Globalization.CultureInfo.InvariantCulture)}ft";

    private static bool IsValidAuthoredPlaneRef(string? authoredRef) {
        var normalized = authoredRef?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
            return false;

        if (normalized.StartsWith("@", StringComparison.Ordinal))
            return normalized.Length > 1;

        if (!normalized.StartsWith("plane:", StringComparison.OrdinalIgnoreCase))
            return false;

        return !string.IsNullOrWhiteSpace(normalized["plane:".Length..].Trim());
    }

    private static bool TryBuildRectangleSpec(
        Extrusion extrusion,
        Document doc,
        out ConstrainedRectangleExtrusionSpec spec
    ) {
        spec = null!;
        if (!IsRectangleProfile(extrusion.Sketch.Profile)) {
            Log.Debug("[ExtrusionSectionCollector] Extrusion {ExtrusionId} was not recognized as a rectangle profile.", extrusion.Id.Value());
            return false;
        }

        if (!TryGetProfilePlanePairs(doc, extrusion, out var pairA, out var pairB)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Rectangle extrusion {ExtrusionId} could not resolve profile plane pairs.",
                extrusion.Id.Value());
            return false;
        }

        var height = TryGetHeightConstraintPair(doc, extrusion, out var heightPair) ? heightPair : default;

        spec = new ConstrainedRectangleExtrusionSpec {
            Name = GetExtrusionName(extrusion),
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            HeightControlMode = height.Plane1 == null || height.Plane2 == null
                ? ExtrusionHeightControlMode.EndOffset
                : ExtrusionHeightControlMode.ReferencePlane,
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
        RefPlaneSnapshot? refPlanesAndDims,
        out ConstrainedCircleExtrusionSpec spec
    ) {
        spec = null!;
        if (!IsCircleProfile(extrusion.Sketch.Profile)) {
            Log.Debug("[ExtrusionSectionCollector] Extrusion {ExtrusionId} was not recognized as a circle profile.", extrusion.Id.Value());
            return false;
        }

        if (!TryGetCircleCenterPlanes(doc, extrusion, out var centerLeftRightPlane, out var centerFrontBackPlane)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} could not resolve center planes.",
                extrusion.Id.Value());
            return false;
        }

        if (!TryGetCircleDiameterParameter(extrusion, doc, out var diameterParameter)) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} could not resolve a labeled diameter parameter.",
                extrusion.Id.Value());
            return false;
        }

        var height = TryGetHeightConstraintPair(doc, extrusion, out var heightPair) ? heightPair : default;

        spec = new ConstrainedCircleExtrusionSpec {
            Name = GetExtrusionName(extrusion),
            IsSolid = extrusion.IsSolid,
            StartOffset = extrusion.StartOffset,
            EndOffset = extrusion.EndOffset,
            HeightControlMode = height.Plane1 == null || height.Plane2 == null
                ? ExtrusionHeightControlMode.EndOffset
                : ExtrusionHeightControlMode.ReferencePlane,
            SketchPlaneName = extrusion.Sketch.SketchPlane?.Name ?? string.Empty,
            CenterPlane1 = centerLeftRightPlane.Name,
            CenterPlane2 = centerFrontBackPlane.Name,
            DiameterParameter = diameterParameter,
            HeightPlaneBottom = height.Plane1?.Name,
            HeightPlaneTop = height.Plane2?.Name,
            HeightParameter = height.ParameterName
        };
        return true;
    }

    private static bool TryGetCircleCenterPlanes(
        Document doc,
        Extrusion extrusion,
        out ReferencePlane centerLeftRightPlane,
        out ReferencePlane centerFrontBackPlane
    ) {
        centerLeftRightPlane = null!;
        centerFrontBackPlane = null!;

        foreach (var dimension in extrusion.Sketch.GetAllElements()
                     .Select(id => doc.GetElement(id))
                     .OfType<Dimension>()) {
            for (var i = 0; i < dimension.References.Size; i++) {
                if (doc.GetElement(dimension.References.get_Item(i)) is not ReferencePlane plane)
                    continue;

                var normal = plane.Normal.Normalize();
                if (Math.Abs(normal.X) >= Math.Abs(normal.Y) && Math.Abs(normal.X) > Math.Abs(normal.Z))
                    centerLeftRightPlane = plane;
                else if (Math.Abs(normal.Y) > Math.Abs(normal.X) && Math.Abs(normal.Y) > Math.Abs(normal.Z))
                    centerFrontBackPlane = plane;
            }
        }

        return centerLeftRightPlane != null && centerFrontBackPlane != null;
    }

    private static bool TryGetCircleDiameterParameter(
        Extrusion extrusion,
        Document doc,
        out string parameterName
    ) {
        parameterName = string.Empty;

        foreach (var dimension in extrusion.Sketch.GetAllElements()
                     .Select(id => doc.GetElement(id))
                     .OfType<Dimension>()) {
            try {
                if (dimension.FamilyLabel?.Definition?.Name is not { Length: > 0 } labelName)
                    continue;

                parameterName = labelName;
                return true;
            } catch {
                // Some sketch dimensions are not labelable; ignore them.
            }
        }

        return false;
    }

    private static bool TryGetCirclePlanePairsFromRefPlaneSnapshot(
        Document doc,
        Extrusion extrusion,
        RefPlaneSnapshot? refPlanesAndDims,
        out DimConstraint pairA,
        out DimConstraint pairB
    ) {
        pairA = default;
        pairB = default;

        if (refPlanesAndDims == null) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} had no RefPlaneSnapshot available for fallback.",
                extrusion.Id.Value());
            return false;
        }

        var sketchPlane = extrusion.Sketch.SketchPlane?.GetPlane();
        if (sketchPlane == null) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} had no sketch plane for fallback.",
                extrusion.Id.Value());
            return false;
        }

        var arcs = extrusion.Sketch.Profile
            .Cast<CurveArray>()
            .SelectMany(loop => loop.Cast<Curve>())
            .OfType<Arc>()
            .ToList();
        if (arcs.Count == 0) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} had no arcs in sketch profile for fallback.",
                extrusion.Id.Value());
            return false;
        }

        var center = arcs[0].Center;
        var radius = arcs[0].Radius;
        var sketchNormal = sketchPlane.Normal.Normalize();
        Log.Debug(
            "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} fallback evaluating {MirrorSpecCount} mirror specs at center {Center} radius {Radius}.",
            extrusion.Id.Value(),
            refPlanesAndDims.MirrorSpecs.Count,
            center,
            radius);
        var candidates = refPlanesAndDims.MirrorSpecs
            .Select(spec => TryBuildCircleMirrorPairCandidate(doc, spec, center, radius, sketchNormal))
            .Where(candidate => candidate != null)
            .Select(candidate => candidate!)
            .GroupBy(candidate => candidate.GroupKey, StringComparer.Ordinal)
            .Select(group => group.First())
            .ToList();

        Log.Debug(
            "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} fallback produced {CandidateCount} candidate plane pairs.",
            extrusion.Id.Value(),
            candidates.Count);

        if (candidates.Count < 2) {
            var topologicalCandidates = refPlanesAndDims.MirrorSpecs
                .Select(spec => TryBuildCircleMirrorTopologyCandidate(doc, spec, sketchNormal))
                .Where(candidate => candidate != null)
                .Select(candidate => candidate!)
                .ToList();

            var exactParameterMatch = topologicalCandidates
                .Where(candidate => !string.IsNullOrWhiteSpace(candidate.Pair.ParameterName))
                .GroupBy(candidate => candidate.Pair.ParameterName!, StringComparer.Ordinal)
                .Select(group => new {
                    Parameter = group.Key,
                    Candidates = group
                        .GroupBy(candidate => candidate.GroupKey, StringComparer.Ordinal)
                        .Select(grouped => grouped.First())
                        .ToList()
                })
                .Where(group => group.Candidates.Count >= 2)
                .OrderByDescending(group => group.Candidates.Count(candidate =>
                    candidate.Spec.Name.Contains("diameter", StringComparison.OrdinalIgnoreCase)))
                .ThenBy(group => group.Parameter, StringComparer.Ordinal)
                .FirstOrDefault();

            if (exactParameterMatch != null) {
                Log.Debug(
                    "[ExtrusionSectionCollector] Circle extrusion {ExtrusionId} fallback recovered plane pairs topologically from parameter {Parameter}.",
                    extrusion.Id.Value(),
                    exactParameterMatch.Parameter);
                pairA = exactParameterMatch.Candidates[0].Pair;
                pairB = exactParameterMatch.Candidates[1].Pair;
                return true;
            }

            return false;
        }

        pairA = candidates[0].Pair;
        pairB = candidates[1].Pair;
        return true;
    }

    private static CircleMirrorPairCandidate? TryBuildCircleMirrorPairCandidate(
        Document doc,
        MirrorSpec spec,
        XYZ center,
        double radius,
        XYZ sketchNormal
    ) {
        var centerPlane = ResolveReferencePlane(doc, spec.CenterAnchor);
        if (centerPlane == null) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle fallback rejected mirror spec {MirrorSpecName}: center anchor {CenterAnchor} missing.",
                spec.Name,
                spec.CenterAnchor);
            return null;
        }

        var centerNormal = centerPlane.Normal.Normalize();
        if (Math.Abs(centerNormal.DotProduct(sketchNormal)) > DotOrthoTolerance) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle fallback rejected mirror spec {MirrorSpecName}: center normal {CenterNormal} not orthogonal to sketch normal {SketchNormal}.",
                spec.Name,
                centerNormal,
                sketchNormal);
            return null;
        }

        var plane1 = ResolveReferencePlane(doc, spec.GetLeftName(centerNormal));
        var plane2 = ResolveReferencePlane(doc, spec.GetRightName(centerNormal));
        if (plane1 == null || plane2 == null) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle fallback rejected mirror spec {MirrorSpecName}: side planes {Plane1Name} / {Plane2Name} missing.",
                spec.Name,
                spec.GetLeftName(centerNormal),
                spec.GetRightName(centerNormal));
            return null;
        }

        var distance1 = Math.Abs((center - plane1.BubbleEnd).DotProduct(plane1.Normal.Normalize()));
        var distance2 = Math.Abs((center - plane2.BubbleEnd).DotProduct(plane2.Normal.Normalize()));
        if (Math.Abs(distance1 - radius) > 1e-3 || Math.Abs(distance2 - radius) > 1e-3) {
            Log.Debug(
                "[ExtrusionSectionCollector] Circle fallback rejected mirror spec {MirrorSpecName}: distances {Distance1}, {Distance2} did not match radius {Radius}.",
                spec.Name,
                distance1,
                distance2,
                radius);
            return null;
        }

        return new CircleMirrorPairCandidate(
            GetParallelPlaneGroupKey(centerNormal),
            new DimConstraint(
                plane1,
                plane2,
                string.IsNullOrWhiteSpace(spec.Parameter) ? FindDimensionLabel(doc, plane1, plane2) : spec.Parameter));
    }

    private static CircleMirrorTopologyCandidate? TryBuildCircleMirrorTopologyCandidate(
        Document doc,
        MirrorSpec spec,
        XYZ sketchNormal
    ) {
        var centerPlane = ResolveReferencePlane(doc, spec.CenterAnchor);
        if (centerPlane == null)
            return null;

        var centerNormal = centerPlane.Normal.Normalize();
        if (Math.Abs(centerNormal.DotProduct(sketchNormal)) > DotOrthoTolerance)
            return null;

        var plane1 = ResolveReferencePlane(doc, spec.GetLeftName(centerNormal));
        var plane2 = ResolveReferencePlane(doc, spec.GetRightName(centerNormal));
        if (plane1 == null || plane2 == null)
            return null;

        return new CircleMirrorTopologyCandidate(
            spec,
            GetParallelPlaneGroupKey(centerNormal),
            new DimConstraint(
                plane1,
                plane2,
                string.IsNullOrWhiteSpace(spec.Parameter) ? FindDimensionLabel(doc, plane1, plane2) : spec.Parameter));
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
        if (profilePlanes.Count < 4) {
            Log.Debug(
                "[ExtrusionSectionCollector] Extrusion {ExtrusionId} found only {PlaneCount} profile planes: {PlaneNames}",
                extrusion.Id.Value(),
                profilePlanes.Count,
                profilePlanes.Select(plane => plane.Name).ToList());
            return false;
        }

        var grouped = profilePlanes
            .GroupBy(plane => GetParallelPlaneGroupKey(plane.Normal.Normalize()))
            .Where(group => group.Count() >= 2)
            .Take(2)
            .ToList();
        if (grouped.Count < 2) {
            Log.Debug(
                "[ExtrusionSectionCollector] Extrusion {ExtrusionId} profile planes could not form two parallel groups. Planes: {PlaneInfo}",
                extrusion.Id.Value(),
                profilePlanes.Select(plane => new {
                    plane.Name,
                    Normal = $"{Math.Round(plane.Normal.X, 4)},{Math.Round(plane.Normal.Y, 4)},{Math.Round(plane.Normal.Z, 4)}"
                }).ToList());
            return false;
        }

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

        if (matched.Count >= 4)
            return matched.Values.ToList();

        foreach (var elementId in extrusion.Sketch.GetAllElements()) {
            if (doc.GetElement(elementId) is not ModelCurve modelCurve)
                continue;

            var alignmentDimensions = modelCurve.GetDependentElements(new ElementClassFilter(typeof(Dimension)))
                .Select(doc.GetElement)
                .OfType<Dimension>()
                .Where(dimension => dimension is not SpotDimension)
                .ToList();

            foreach (var dimension in alignmentDimensions) {
                for (var i = 0; i < dimension.References.Size; i++) {
                    if (doc.GetElement(dimension.References.get_Item(i)) is not ReferencePlane plane)
                        continue;

                    if (string.IsNullOrWhiteSpace(plane.Name))
                        continue;

                    matched[plane.Id] = plane;
                }
            }
        }

        var matchedPlanes = matched.Values.ToList();
        if (matchedPlanes.Count > 0) {
            Log.Debug(
                "[ExtrusionSectionCollector] Extrusion {ExtrusionId} matched {PlaneCount} profile planes after fallback: {PlaneNames}",
                extrusion.Id.Value(),
                matchedPlanes.Count,
                matchedPlanes.Select(plane => plane.Name).ToList());
        }

        return matchedPlanes;
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

    private static string BuildSymmetricKey(SymmetricPlanePairSpec spec) =>
        $"M|{spec.PlaneNameBase}|{spec.CenterPlaneName}|{spec.Parameter}|{spec.Strength}";
    
    private static string BuildMirrorKey(MirrorSpec spec) =>
        $"M|{spec.Name}|{spec.CenterAnchor}|{spec.Parameter}|{spec.Strength}";

    private static string BuildOffsetKey(OffsetPlaneConstraintSpec spec) =>
        $"O|{spec.PlaneName}|{spec.AnchorPlaneName}|{spec.Direction}|{spec.Parameter}|{spec.Strength}";

    private static string BuildOffsetKey(OffsetSpec spec) =>
        $"O|{spec.Name}|{spec.AnchorName}|{spec.Direction}|{spec.Parameter}|{spec.Strength}";

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

    private sealed record CircleMirrorPairCandidate(string GroupKey, DimConstraint Pair);
    private sealed record CircleMirrorTopologyCandidate(MirrorSpec Spec, string GroupKey, DimConstraint Pair);

    private enum SolidAxis {
        Width,
        Length,
        Height
    }
}
