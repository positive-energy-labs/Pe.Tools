using Pe.Extensions.FamDocument;
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
    private const double DotOrthoTolerance = 0.15;
    private const double PlaneTolerance = 1e-6;
    private const double DistanceTolerance = 1e-4;

    public bool ShouldCollect(FamilySnapshot snapshot) =>
        snapshot.ParamDrivenSolids == null || !snapshot.ParamDrivenSolids.HasContent;

    public void Collect(FamilySnapshot snapshot, FamilyDocument famDoc) {
        var legacy = CollectLegacyFromFamilyDoc(famDoc.Document, snapshot.RefPlanesAndDims);
        var semanticSnapshot = CollectSemanticSnapshot(
            famDoc.Document,
            legacy,
            snapshot.RefPlanesAndDims);
        var authoredSnapshot = BuildAuthoredSolids(semanticSnapshot, legacy);
        AddInferredRawConnectors(famDoc.Document, authoredSnapshot);
        snapshot.ParamDrivenSolids = authoredSnapshot;
        snapshot.RefPlanesAndDims = RemoveSemanticInternalConstraints(
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

    private static ParamDrivenSolidsSnapshot CollectSemanticSnapshot(
        Document doc,
        ExtrusionSnapshot legacy,
        RefPlaneSnapshot? refPlanesAndDims
    ) {
        var result = new ParamDrivenSolidsSnapshot {
            Source = SnapshotSource.FamilyDoc,
            Frame = ParamDrivenFamilyFrameKind.NonHosted
        };

        foreach (var rectangle in legacy.Rectangles) {
            var planeRegistry = SemanticPlaneRegistry.Create(result.Rectangles, result.Cylinders, result.SemanticPlanes);
            var semantic = TryBuildSemanticRectangle(doc, rectangle, refPlanesAndDims, planeRegistry);
            if (semantic != null)
                result.Rectangles.Add(semantic);
        }

        foreach (var circle in legacy.Circles) {
            var planeRegistry = SemanticPlaneRegistry.Create(result.Rectangles, result.Cylinders, result.SemanticPlanes);
            var semantic = TryBuildSemanticCylinder(doc, circle, refPlanesAndDims, planeRegistry);
            if (semantic != null)
                result.Cylinders.Add(semantic);
        }

        AddRawSemanticConnectors(
            doc,
            result,
            SemanticPlaneRegistry.Create(result.Rectangles, result.Cylinders, result.SemanticPlanes, true));

        var residual = RemoveSemanticInternalConstraints(refPlanesAndDims, BuildAuthoredSolids(result, legacy));
        PromoteResidualSemanticPlanes(result, residual, SemanticPlaneRegistry.Create(result.Rectangles, result.Cylinders, result.SemanticPlanes));
        NormalizeDerivedPlaneTargets(
            result,
            SemanticPlaneRegistry.Create(result.Rectangles, result.Cylinders, result.SemanticPlanes, true));

        return result;
    }

    private static RefPlaneSnapshot? RemoveSemanticInternalConstraints(
        RefPlaneSnapshot? refPlaneSnapshot,
        AuthoredParamDrivenSolidsSettings authoredSnapshot
    ) {
        if (refPlaneSnapshot == null)
            return null;

        if (!authoredSnapshot.HasContent)
            return refPlaneSnapshot;

        var compiledSemantics = AuthoredParamDrivenSolidsCompiler.Compile(authoredSnapshot);
        if (!compiledSemantics.CanExecute)
            return refPlaneSnapshot;

        var internalMirrorKeys = compiledSemantics.RefPlanesAndDims.SymmetricPairs
            .Select(BuildSymmetricKey)
            .ToHashSet(StringComparer.Ordinal);
        var internalOffsetKeys = compiledSemantics.RefPlanesAndDims.Offsets
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

    private static void PromoteResidualSemanticPlanes(
        ParamDrivenSolidsSnapshot semanticSnapshot,
        RefPlaneSnapshot? refPlaneSnapshot,
        SemanticPlaneRegistry planeRegistry
    ) {
        if (refPlaneSnapshot == null)
            return;

        var usedNames = semanticSnapshot.SemanticPlanes
            .Where(spec => !string.IsNullOrWhiteSpace(spec.Name))
            .Select(spec => spec.Name.Trim())
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var spec in refPlaneSnapshot.OffsetSpecs) {
            var semanticName = BuildResidualSemanticPlaneName(spec, usedNames);
            if (string.IsNullOrWhiteSpace(semanticName))
                semanticName = $"Semantic Plane {semanticSnapshot.SemanticPlanes.Count + 1}";

            _ = usedNames.Add(semanticName);

            semanticSnapshot.SemanticPlanes.Add(new SemanticPlaneSpec {
                Name = semanticName,
                Constraint = new AxisConstraintSpec {
                    Mode = AxisConstraintMode.Offset,
                    Parameter = spec.Parameter ?? string.Empty,
                    Anchor = planeRegistry.BuildPlaneTarget(spec.AnchorName),
                    Direction = spec.Direction,
                    PlaneNameBase = semanticName,
                    Strength = spec.Strength,
                    Inference = new InferenceInfo { Status = InferenceStatus.Exact }
                }
            });
        }
    }

    private static string BuildResidualSemanticPlaneName(OffsetSpec spec, ISet<string> usedNames) {
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

    private static void NormalizeDerivedPlaneTargets(
        ParamDrivenSolidsSnapshot semanticSnapshot,
        SemanticPlaneRegistry planeRegistry
    ) {
        semanticSnapshot.Rectangles = semanticSnapshot.Rectangles
            .Select(rectangle => new ParamDrivenRectangleSpec {
                Name = rectangle.Name,
                IsSolid = rectangle.IsSolid,
                Sketch = planeRegistry.NormalizePlaneTarget(rectangle.Sketch),
                Width = CloneAxisConstraint(rectangle.Width, planeRegistry),
                Length = CloneAxisConstraint(rectangle.Length, planeRegistry),
                Height = CloneAxisConstraint(rectangle.Height, planeRegistry),
                Offsets = rectangle.Offsets
                    .Select(offset => new LocalSemanticPlaneSpec {
                        Name = offset.Name,
                        Constraint = CloneAxisConstraint(offset.Constraint, planeRegistry)
                    })
                    .ToList(),
                Inference = rectangle.Inference
            })
            .ToList();

        semanticSnapshot.Connectors = semanticSnapshot.Connectors
            .Select(connector => new ParamDrivenConnectorSpec {
                Name = connector.Name,
                Domain = connector.Domain,
                Placement = new ConnectorPlacementSpec {
                    Face = planeRegistry.NormalizePlaneTarget(connector.Placement.Face),
                    Depth = CloneAxisConstraint(connector.Placement.Depth, planeRegistry)
                },
                Geometry = new ConnectorStubGeometrySpec {
                    IsSolid = connector.Geometry.IsSolid,
                    Rectangular = connector.Geometry.Rectangular == null
                        ? null
                        : new RectangularConnectorGeometrySpec {
                            Width = CloneAxisConstraint(connector.Geometry.Rectangular.Width, planeRegistry),
                            Length = CloneAxisConstraint(connector.Geometry.Rectangular.Length, planeRegistry)
                        },
                    Round = connector.Geometry.Round == null
                        ? null
                        : new RoundConnectorGeometrySpec {
                            Center = new PlaneIntersectionSpec {
                                Plane1 = planeRegistry.NormalizePlaneTarget(connector.Geometry.Round.Center.Plane1),
                                Plane2 = planeRegistry.NormalizePlaneTarget(connector.Geometry.Round.Center.Plane2)
                            },
                            Diameter = CloneAxisConstraint(connector.Geometry.Round.Diameter, planeRegistry)
                        }
                },
                Bindings = connector.Bindings,
                Config = connector.Config,
                Inference = connector.Inference
            })
            .ToList();
    }

    private static AxisConstraintSpec CloneAxisConstraint(
        AxisConstraintSpec constraint,
        SemanticPlaneRegistry planeRegistry
    ) => new() {
        Mode = constraint.Mode,
        Parameter = constraint.Parameter,
        CenterAnchor = planeRegistry.NormalizePlaneTarget(constraint.CenterAnchor),
        Anchor = planeRegistry.NormalizePlaneTarget(constraint.Anchor),
        Direction = constraint.Direction,
        PlaneNameBase = constraint.PlaneNameBase,
        Strength = constraint.Strength,
        Inference = constraint.Inference
    };

    private static ParamDrivenRectangleSpec? TryBuildSemanticRectangle(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        SemanticPlaneRegistry planeRegistry
    ) {
        if (!TryClassifyRectanglePairs(doc, spec, out var widthPair, out var lengthPair))
            return null;

        var width = BuildAxisConstraint(doc, widthPair, refPlanesAndDims, planeRegistry, AxisSemanticRole.Width, spec.Name, "Width");
        var length = BuildAxisConstraint(doc, lengthPair, refPlanesAndDims, planeRegistry, AxisSemanticRole.Length, spec.Name, "Length");
        var height = BuildHeightConstraint(doc, spec, refPlanesAndDims, planeRegistry);

        return new ParamDrivenRectangleSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            Sketch = planeRegistry.BuildPlaneTarget(spec.SketchPlaneName),
            Width = width,
            Length = length,
            Height = height
        };
    }

    private static ParamDrivenCylinderSpec? TryBuildSemanticCylinder(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        SemanticPlaneRegistry planeRegistry
    ) {
        var height = BuildHeightConstraint(doc, spec, refPlanesAndDims, planeRegistry);

        var diameter = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = spec.DiameterParameter,
            Inference = new InferenceInfo { Status = InferenceStatus.Exact }
        };

        return new ParamDrivenCylinderSpec {
            Name = spec.Name,
            IsSolid = spec.IsSolid,
            Sketch = planeRegistry.BuildPlaneTarget(spec.SketchPlaneName),
            Center = new PlaneIntersectionSpec {
                Plane1 = planeRegistry.BuildPlaneTarget(spec.CenterPlane1),
                Plane2 = planeRegistry.BuildPlaneTarget(spec.CenterPlane2)
            },
            Diameter = diameter,
            Height = height
        };
    }

    private static AxisConstraintSpec BuildHeightConstraint(
        Document doc,
        ConstrainedRectangleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        SemanticPlaneRegistry planeRegistry
    ) {
        var pair = new NamedPlanePair(spec.HeightPlaneBottom, spec.HeightPlaneTop, spec.HeightParameter);
        return BuildAxisConstraint(doc, pair, refPlanesAndDims, planeRegistry, AxisSemanticRole.Height, spec.Name, "Height", spec.SketchPlaneName);
    }

    private static AxisConstraintSpec BuildHeightConstraint(
        Document doc,
        ConstrainedCircleExtrusionSpec spec,
        RefPlaneSnapshot? refPlanesAndDims,
        SemanticPlaneRegistry planeRegistry
    ) {
        var pair = new NamedPlanePair(spec.HeightPlaneBottom, spec.HeightPlaneTop, spec.HeightParameter);
        return BuildAxisConstraint(doc, pair, refPlanesAndDims, planeRegistry, AxisSemanticRole.Height, spec.Name, "Height", spec.SketchPlaneName);
    }

    private static AxisConstraintSpec BuildAxisConstraint(
        Document doc,
        NamedPlanePair pair,
        RefPlaneSnapshot? refPlanesAndDims,
        SemanticPlaneRegistry planeRegistry,
        AxisSemanticRole role,
        string solidName,
        string axisName,
        string? preferredAnchorPlaneName = null
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
                CenterAnchor = planeRegistry.BuildPlaneTarget(mirrorMatch.CenterAnchor),
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
                Anchor = planeRegistry.BuildPlaneTarget(offsetMatch.AnchorName),
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

        var resolvedPreferredAnchor = planeRegistry.BuildPlaneTarget(preferredAnchorPlaneName);
        var resolvedPairAnchor = planeRegistry.BuildPlaneTarget(pair.Plane1);
        var inferredAnchor = TrySelectPreferredAnchor(resolvedPreferredAnchor, resolvedPairAnchor);

        return new AxisConstraintSpec {
            Mode = AxisConstraintMode.Offset,
            Parameter = pair.Parameter,
            Anchor = inferredAnchor,
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

    private static PlaneTargetSpec TrySelectPreferredAnchor(
        PlaneTargetSpec preferred,
        PlaneTargetSpec fallback
    ) {
        if (!IsEmptyAnchor(preferred))
            return preferred;

        return fallback;
    }

    private static bool IsEmptyAnchor(PlaneTargetSpec anchor) =>
        anchor.Frame == null &&
        anchor.Derived == null &&
        anchor.Semantic == null;

    private enum AxisSemanticRole {
        Width,
        Length,
        Height
    }

    private sealed class SemanticPlaneRegistry {
        private readonly Dictionary<string, PlaneTargetSpec> _anchors;

        private SemanticPlaneRegistry(Dictionary<string, PlaneTargetSpec> anchors) {
            _anchors = anchors;
        }

        public static SemanticPlaneRegistry Create(
            IReadOnlyList<ParamDrivenRectangleSpec> rectangles,
            IReadOnlyList<ParamDrivenCylinderSpec> cylinders,
            IReadOnlyList<SemanticPlaneSpec> semanticPlanes,
            bool includeCylinderDerivedAliases = false
        ) {
            var anchors = new Dictionary<string, PlaneTargetSpec>(StringComparer.OrdinalIgnoreCase) {
                ["Reference Plane"] = new PlaneTargetSpec { Frame = new FramePlaneTargetSpec { Plane = ParamDrivenFramePlane.Bottom } },
                ["Ref. Level"] = new PlaneTargetSpec { Frame = new FramePlaneTargetSpec { Plane = ParamDrivenFramePlane.Bottom } },
                ["Center (Left/Right)"] = new PlaneTargetSpec { Frame = new FramePlaneTargetSpec { Plane = ParamDrivenFramePlane.CenterLR } },
                ["Center (Front/Back)"] = new PlaneTargetSpec { Frame = new FramePlaneTargetSpec { Plane = ParamDrivenFramePlane.CenterFB } }
            };

            foreach (var rectangle in rectangles) {
                AddIfPresent(anchors, rectangle.Height.PlaneNameBase, rectangle.Name, ParamDrivenDerivedPlaneKind.Top);
                AddIfPresent(anchors, $"{rectangle.Width.PlaneNameBase} (Back)", rectangle.Name, ParamDrivenDerivedPlaneKind.Back);
                AddIfPresent(anchors, $"{rectangle.Width.PlaneNameBase} (Front)", rectangle.Name, ParamDrivenDerivedPlaneKind.Front);
                AddIfPresent(anchors, $"{rectangle.Length.PlaneNameBase} (Left)", rectangle.Name, ParamDrivenDerivedPlaneKind.Left);
                AddIfPresent(anchors, $"{rectangle.Length.PlaneNameBase} (Right)", rectangle.Name, ParamDrivenDerivedPlaneKind.Right);
            }

            foreach (var semanticPlane in semanticPlanes.Where(spec => !string.IsNullOrWhiteSpace(spec.Name))) {
                anchors[semanticPlane.Name.Trim()] = new PlaneTargetSpec {
                    Semantic = new SemanticPlaneTargetSpec { Name = semanticPlane.Name.Trim() }
                };
            }

            var registry = new SemanticPlaneRegistry(anchors);

            if (includeCylinderDerivedAliases)
                foreach (var cylinder in cylinders) {
                    AddIfPresent(anchors, cylinder.Height.PlaneNameBase, cylinder.Name, ParamDrivenDerivedPlaneKind.Top);
                    registry.AddCylinderCenterAlias(cylinder, cylinder.Center.Plane1);
                    registry.AddCylinderCenterAlias(cylinder, cylinder.Center.Plane2);
                }

            return registry;
        }

        public PlaneTargetSpec BuildPlaneTarget(string? planeName) {
            if (string.IsNullOrWhiteSpace(planeName))
                return new PlaneTargetSpec();

            var trimmed = planeName.Trim();
            if (_anchors.TryGetValue(trimmed, out var anchor))
                return anchor;

            return new PlaneTargetSpec {
                Semantic = new SemanticPlaneTargetSpec { Name = trimmed }
            };
        }

        public PlaneTargetSpec NormalizePlaneTarget(PlaneTargetSpec target) {
            var planeName = this.ResolvePlaneName(target);
            return string.IsNullOrWhiteSpace(planeName)
                ? target
                : this.BuildPlaneTarget(planeName);
        }

        private static void AddIfPresent(
            Dictionary<string, PlaneTargetSpec> anchors,
            string? planeName,
            string solidName,
            ParamDrivenDerivedPlaneKind plane
        ) {
            if (string.IsNullOrWhiteSpace(planeName))
                return;

            anchors[planeName.Trim()] = new PlaneTargetSpec {
                Derived = new DerivedPlaneTargetSpec {
                    Solid = solidName,
                    Plane = plane
                }
            };
        }

        private void AddCylinderCenterAlias(ParamDrivenCylinderSpec cylinder, PlaneTargetSpec centerTarget) {
            var planeName = this.ResolvePlaneName(centerTarget);
            var planeKind = TryInferCylinderCenterKind(centerTarget, planeName);
            if (string.IsNullOrWhiteSpace(planeName) || planeKind == null)
                return;

            _anchors[planeName] = new PlaneTargetSpec {
                Derived = new DerivedPlaneTargetSpec {
                    Solid = cylinder.Name,
                    Plane = planeKind.Value
                }
            };
        }

        private string? ResolvePlaneName(PlaneTargetSpec target) {
            if (target.Frame?.Plane != null)
                return target.Frame.Plane switch {
                    ParamDrivenFramePlane.Bottom => "Reference Plane",
                    ParamDrivenFramePlane.CenterLR => "Center (Left/Right)",
                    ParamDrivenFramePlane.CenterFB => "Center (Front/Back)",
                    _ => null
                };

            if (target.Semantic != null)
                return target.Semantic.Name?.Trim();

            foreach (var (planeName, planeTarget) in _anchors) {
                if (PlaneTargetsEqual(planeTarget, target))
                    return planeName;
            }

            return null;
        }

        private static bool PlaneTargetsEqual(PlaneTargetSpec left, PlaneTargetSpec right) {
            if (left.Frame?.Plane != null || right.Frame?.Plane != null)
                return left.Frame?.Plane == right.Frame?.Plane;

            if (left.Semantic != null || right.Semantic != null)
                return string.Equals(left.Semantic?.Name, right.Semantic?.Name, StringComparison.OrdinalIgnoreCase);

            return left.Derived?.Solid == right.Derived?.Solid &&
                   left.Derived?.Plane == right.Derived?.Plane;
        }

        private static ParamDrivenDerivedPlaneKind? TryInferCylinderCenterKind(PlaneTargetSpec target, string? planeName) {
            if (target.Frame?.Plane == ParamDrivenFramePlane.CenterLR)
                return ParamDrivenDerivedPlaneKind.CenterLR;
            if (target.Frame?.Plane == ParamDrivenFramePlane.CenterFB)
                return ParamDrivenDerivedPlaneKind.CenterFB;

            if (target.Derived?.Plane is ParamDrivenDerivedPlaneKind.Left or ParamDrivenDerivedPlaneKind.Right or ParamDrivenDerivedPlaneKind.CenterLR)
                return ParamDrivenDerivedPlaneKind.CenterLR;
            if (target.Derived?.Plane is ParamDrivenDerivedPlaneKind.Front or ParamDrivenDerivedPlaneKind.Back or ParamDrivenDerivedPlaneKind.CenterFB)
                return ParamDrivenDerivedPlaneKind.CenterFB;

            if (string.IsNullOrWhiteSpace(planeName))
                return null;

            if (planeName.Contains("Left", StringComparison.OrdinalIgnoreCase) ||
                planeName.Contains("Right", StringComparison.OrdinalIgnoreCase))
                return ParamDrivenDerivedPlaneKind.CenterLR;

            if (planeName.Contains("Front", StringComparison.OrdinalIgnoreCase) ||
                planeName.Contains("Back", StringComparison.OrdinalIgnoreCase))
                return ParamDrivenDerivedPlaneKind.CenterFB;

            return null;
        }
    }
}
