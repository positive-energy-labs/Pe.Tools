using System.Globalization;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>
///     The INTENT oracle. It predicts where a family's geometry must land from the portable
///     `family.json` alone, with pure arithmetic and no Revit API type.
/// </summary>
/// <remarks>
///     <para>
///         The roundtrip suite compares Revit against Revit. It proves that build → capture → rebuild is
///         self-consistent. A placement convention that is systematically wrong stays invisible to it,
///         because both sides are wrong in the same way. This oracle supplies the missing edge: the
///         portable document predicts coordinates, and the Revit probe must agree with the prediction.
///     </para>
///     <para>
///         Every geometric decision comes from <see cref="FamilyModelEvaluatorConventions" />. This file
///         resolves references and units; it never restates the axis signs, the face coordinates, the
///         family plane directions, or the rotation math. If a convention is wrong, the conformance
///         vectors and this oracle must fail together, not disagree.
///     </para>
///     <para>
///         Scope is the current vocabulary: `Prism` / `Cylinder` / `ExtrudedPolygon` and their voids, on
///         the family frame or on any declared frame, with at most one `rotation` clause per frame. Type-conditional
///         constituent existence is out of scope and is not guessed.
///     </para>
/// </remarks>
internal static class FamilyModelEvaluatorOracle {
    private const string FamilyPlanePrefix = "family.";
    private const string FamilyFrame = "frame:family";

    /// <summary>
    ///     Predicts the geometry of one family type. <paramref name="parameterValuesInFeet" /> is the
    ///     probe's resolved parameter table, which already carries Revit internal units (feet, and radians
    ///     for angles). Portable literals in the document are converted here, so predictions and probe
    ///     readings share one unit system.
    /// </summary>
    public static FamilyModelPrediction Predict(
        FamilyModel model,
        IReadOnlyDictionary<string, double> parameterValuesInFeet
    ) {
        var frames = new FrameResolver(model, parameterValuesInFeet);
        var solids = model.Solids
            .Select(pair => PredictSolid(pair.Key, pair.Value, parameterValuesInFeet, frames))
            .ToList();
        var planes = model.Planes
            .Select(pair => new PredictedPlane(pair.Key, frames.ResolvePlaneOrFace($"plane:{pair.Key}", $"$.planes.{pair.Key}")))
            .ToList();

        return new FamilyModelPrediction(solids, planes);
    }

    private static PredictedSolid PredictSolid(
        string slug,
        FamilyModelSolid solid,
        IReadOnlyDictionary<string, double> parameters,
        FrameResolver frames
    ) {
        var frame = frames.ResolveFrame(solid.Frame, $"$.solids.{slug}.frame");
        var height = ResolveLengthFeet(solid.Height, $"$.solids.{slug}.height", parameters);
        if (solid.Kind is FamilySolidKind.ExtrudedPolygon or FamilySolidKind.VoidExtrudedPolygon) {
            var profile = ResolveProfile(slug, solid, parameters);
            var polygonBounds = FamilyModelEvaluatorConventions.ResolvePolygonBounds(profile, height);
            // A polygon's world extremes are its own vertices at both ends of the extrusion — exactly, on a
            // turned frame too, because every vertex is a corner of the solid.
            var corners = profile
                .SelectMany(point => new[] { polygonBounds.Z.Minimum, polygonBounds.Z.Maximum }
                    .Select(z => frame.Apply(new FamilyModelVector(point.X, point.Y, z))))
                .ToList();
            return new PredictedSolid(slug, solid.Kind, Minimum(corners), Maximum(corners), null);
        }

        if (solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism) {
            var width = ResolveLengthFeet(solid.Width, $"$.solids.{slug}.width", parameters);
            var depth = ResolveLengthFeet(solid.Depth, $"$.solids.{slug}.depth", parameters);
            var (minimum, maximum) = WorldBounds(frame, width, depth, height);
            return new PredictedSolid(slug, solid.Kind, minimum, maximum, null);
        }

        var diameter = ResolveLengthFeet(solid.Diameter, $"$.solids.{slug}.diameter", parameters);
        var bounds = FamilyModelEvaluatorConventions.ResolveCylinderBounds(diameter, height);
        if (!frame.IsAxisAligned) {
            // The circular sweep of a turned cylinder does not follow the corners of its local box, and no
            // authored family needs one yet. Refuse rather than report a bounding box that is not the solid.
            throw new InvalidOperationException(
                $"$.solids.{slug}: the bounds of a cylinder on a turned frame are not predicted.");
        }

        var (cylinderMinimum, cylinderMaximum) = WorldBounds(
            frame,
            bounds.X.Maximum - bounds.X.Minimum,
            bounds.Y.Maximum - bounds.Y.Minimum,
            bounds.Z.Maximum);
        return new PredictedSolid(slug, solid.Kind, cylinderMinimum, cylinderMaximum, diameter);
    }

    /// <summary>
    ///     Projects the eight corners of one solid's local box into family coordinates and takes their
    ///     axis-aligned bounds — which is exactly what Revit reports for a box, turned or not.
    /// </summary>
    private static (PredictedPoint Minimum, PredictedPoint Maximum) WorldBounds(
        FamilyModelTransform frame,
        double width,
        double depth,
        double height
    ) {
        var corners = new List<FamilyModelVector>();
        foreach (var x in new[] {
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Left", width, depth, height).Coordinate,
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Right", width, depth, height).Coordinate
                 })
        foreach (var y in new[] {
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Back", width, depth, height).Coordinate,
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Front", width, depth, height).Coordinate
                 })
        foreach (var z in new[] {
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Bottom", width, depth, height).Coordinate,
                     FamilyModelEvaluatorConventions.ResolvePrismFace("Top", width, depth, height).Coordinate
                 })
            corners.Add(frame.Apply(new FamilyModelVector(x, y, z)));

        return (Minimum(corners), Maximum(corners));
    }

    private static PredictedPoint Minimum(IReadOnlyCollection<FamilyModelVector> corners) => new(
        corners.Min(corner => corner.X), corners.Min(corner => corner.Y), corners.Min(corner => corner.Z));

    private static PredictedPoint Maximum(IReadOnlyCollection<FamilyModelVector> corners) => new(
        corners.Max(corner => corner.X), corners.Max(corner => corner.Y), corners.Max(corner => corner.Z));

    /// <summary>Resolves every authored profile point to feet, in the frame's XY plane.</summary>
    private static IReadOnlyList<FamilyModelProfilePointValue> ResolveProfile(
        string slug,
        FamilyModelSolid solid,
        IReadOnlyDictionary<string, double> parameters
    ) => solid.Profile
        .Select((point, index) => new FamilyModelProfilePointValue(
            ResolveLengthFeet(point.X, $"$.solids.{slug}.profile[{index}].x", parameters),
            ResolveLengthFeet(point.Y, $"$.solids.{slug}.profile[{index}].y", parameters)))
        .ToList();

    /// <summary>
    ///     Walks the frame tree. Frames position themselves off planes and off faces of solids, and those
    ///     solids sit on frames, so resolution is recursive; the validator rejects cycles, and this guard
    ///     makes a cycle that slipped through fail loudly instead of running forever.
    /// </summary>
    private sealed class FrameResolver(FamilyModel model, IReadOnlyDictionary<string, double> parameters) {
        private readonly Dictionary<string, FamilyModelTransform> _resolved = new(StringComparer.Ordinal);
        private readonly HashSet<string> _walking = new(StringComparer.Ordinal);

        public FamilyModelTransform ResolveFrame(string reference, string path) {
            if (string.Equals(reference, FamilyFrame, StringComparison.Ordinal))
                return FamilyModelTransform.Identity;

            if (!PortableFamilyReference.TryParse(reference, out var parsed) ||
                parsed.Kind != PortableFamilyReferenceKind.Frame)
                throw new InvalidOperationException($"{path}: '{reference}' is not a frame reference.");

            if (this._resolved.TryGetValue(parsed.Target, out var cached))
                return cached;

            if (!this._walking.Add(parsed.Target))
                throw new InvalidOperationException($"{path}: frame '{parsed.Target}' derives from itself.");

            var frame = model.Frames[parsed.Target];
            var framePath = $"$.frames.{parsed.Target}";
            var origin = FamilyModelEvaluatorConventions.IntersectPlanes(
                this.ResolvePlaneOrFace(frame.Origin[0], $"{framePath}.origin[0]"),
                this.ResolvePlaneOrFace(frame.Origin[1], $"{framePath}.origin[1]"),
                this.ResolvePlaneOrFace(frame.Origin[2], $"{framePath}.origin[2]"));
            var transform = FamilyModelEvaluatorConventions.ResolveFrameBasis(origin, frame.Normal, frame.Up);
            if (frame.Rotation != null) {
                transform = FamilyModelEvaluatorConventions.Rotate(
                    transform,
                    FamilyModelEvaluatorConventions.ResolveRotationAxis(frame.Rotation.About, transform),
                    FamilyModelEvaluatorConventions.ResolveAngleDegrees(frame.Rotation.By, parameters));
            }

            _ = this._walking.Remove(parsed.Target);
            this._resolved[parsed.Target] = transform;
            return transform;
        }

        /// <summary>
        ///     Resolves one authored reference to the infinite plane it names, as a point plus the outward
        ///     normal. A reference plane has no in-plane position that the portable document fixes, which is
        ///     why only the plane itself is a claim.
        /// </summary>
        public FamilyModelPlaneGeometry ResolvePlaneOrFace(string reference, string path) {
            if (!PortableFamilyReference.TryParse(reference, out var parsed))
                throw new InvalidOperationException($"{path}: '{reference}' is not a portable reference.");

            if (parsed.Kind == PortableFamilyReferenceKind.Plane) {
                // Substring, not a range operator: this harness also compiles for the .NET Framework Revit
                // years, where System.Range resolves ambiguously across the referenced assemblies.
                if (parsed.Target.StartsWith(FamilyPlanePrefix, StringComparison.Ordinal)) {
                    var member = FamilyModelEvaluatorConventions.ResolveFamilyPlane(
                        parsed.Target.Substring(FamilyPlanePrefix.Length));
                    return new FamilyModelPlaneGeometry(FamilyModelVector.Zero, member.Outward);
                }

                var plane = model.Planes[parsed.Target];
                var source = this.ResolvePlaneOrFace(plane.From, $"$.planes.{parsed.Target}.from");
                var distance = ResolveLengthFeet(plane.By, $"$.planes.{parsed.Target}.by", parameters);
                // Offset() owns the In/Out sign; the source plane's own outward normal owns the direction, and
                // an offset plane keeps facing the way its source faces.
                return source with {
                    Point = source.Point +
                            (source.Normal * FamilyModelEvaluatorConventions.Offset(distance, plane.Direction))
                };
            }

            if (parsed.Kind != PortableFamilyReferenceKind.Face)
                throw new InvalidOperationException($"{path}: '{reference}' must reference a plane or a solid face.");

            var slug = parsed.Target;
            var face = parsed.Member!;
            var solid = model.Solids[slug];
            var frame = this.ResolveFrame(solid.Frame, $"$.solids.{slug}.frame");
            var height = ResolveLengthFeet(solid.Height, $"$.solids.{slug}.height", parameters);
            // A cylinder is square in plan for face purposes: its Left/Right/Back/Front tangents sit at half
            // the diameter. "Side" is curved and is rejected by the schema, so it never reaches this oracle.
            var width = solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism
                ? ResolveLengthFeet(solid.Width, $"$.solids.{slug}.width", parameters)
                : ResolveLengthFeet(solid.Diameter, $"$.solids.{slug}.diameter", parameters);
            var depth = solid.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism
                ? ResolveLengthFeet(solid.Depth, $"$.solids.{slug}.depth", parameters)
                : width;

            var resolved = FamilyModelEvaluatorConventions.ResolvePrismFace(face, width, depth, height);
            var local = new FamilyModelVector(
                resolved.Axis == FamilyModelCoordinateAxis.X ? resolved.Coordinate : 0,
                resolved.Axis == FamilyModelCoordinateAxis.Y ? resolved.Coordinate : 0,
                resolved.Axis == FamilyModelCoordinateAxis.Z ? resolved.Coordinate : 0);
            return new FamilyModelPlaneGeometry(
                frame.Apply(local),
                frame.Basis(resolved.Axis) * OutwardSign(face));
        }
    }

    /// <summary>
    ///     Reads the outward orientation of a named face out of the conventions instead of restating it.
    ///     A unit prism puts Left/Back at -1, Right/Front/Top at +1, and Bottom at 0, which is the solid's
    ///     own bottom plane; outward from the bottom is up, so a non-negative coordinate means +1.
    /// </summary>
    private static int OutwardSign(string face) =>
        FamilyModelEvaluatorConventions.ResolvePrismFace(face, 2, 2, 1).Coordinate < 0 ? -1 : 1;

    /// <summary>
    ///     Units come from <see cref="FamilyModelEvaluatorConventions.ResolveLengthFeet" />; the probe's
    ///     parameter table is already in Revit internal feet. This wrapper only adds the authored path and,
    ///     when a parameter is missing, the list of what the probe actually carried — the difference
    ///     between a one-minute and a one-hour diagnosis in the fresh lane.
    /// </summary>
    private static double ResolveLengthFeet(
        string? driver,
        string path,
        IReadOnlyDictionary<string, double> parameters
    ) {
        try {
            return FamilyModelEvaluatorConventions.ResolveLengthFeet(driver, parameters);
        } catch (InvalidOperationException exception) {
            throw new InvalidOperationException(
                $"{path}: {exception.Message} " +
                $"Probed parameters: {string.Join(", ", parameters.Keys.OrderBy(name => name, StringComparer.Ordinal))}");
        }
    }

    internal static string Format(double value) => value.ToString("0.########", CultureInfo.InvariantCulture);
}

internal readonly record struct PredictedPoint(double X, double Y, double Z) {
    public double Component(FamilyModelCoordinateAxis axis) => axis switch {
        FamilyModelCoordinateAxis.X => this.X,
        FamilyModelCoordinateAxis.Y => this.Y,
        _ => this.Z
    };

    public override string ToString() =>
        $"[{FamilyModelEvaluatorOracle.Format(this.X)}, {FamilyModelEvaluatorOracle.Format(this.Y)}, " +
        $"{FamilyModelEvaluatorOracle.Format(this.Z)}]";
}

internal sealed record PredictedSolid(
    string Slug,
    FamilySolidKind Kind,
    PredictedPoint Min,
    PredictedPoint Max,
    double? Diameter
) {
    public bool IsSolid =>
        this.Kind is FamilySolidKind.Prism or FamilySolidKind.Cylinder or FamilySolidKind.ExtrudedPolygon;

    public bool IsPrism => this.Kind is FamilySolidKind.Prism or FamilySolidKind.VoidPrism;

    public bool IsCylinder => this.Kind is FamilySolidKind.Cylinder or FamilySolidKind.VoidCylinder;
}

internal sealed record PredictedPlane(string Name, FamilyModelPlaneGeometry Geometry);

internal sealed record FamilyModelPrediction(
    IReadOnlyList<PredictedSolid> Solids,
    IReadOnlyList<PredictedPlane> Planes
);
