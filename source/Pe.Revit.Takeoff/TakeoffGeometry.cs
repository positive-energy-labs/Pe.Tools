using NetTopologySuite.Geometries;

namespace Pe.Revit.Takeoff;

/// <summary>
/// One geometry currency for the takeoff solver: a single loop → NTS polygon converter and a
/// single shoelace area. Every gate now argues about the same coordinates.
/// </summary>
/// <remarks>
/// There are exactly two precision models, and which one a call site uses is a stated choice, not
/// an accident of which file it lives in:
/// <list type="bullet">
/// <item><see cref="Factory"/> — floating. The measurement currency: promotion, the frame
/// projector, and evidence fidelity all measure areas here, because the accounting law closes to
/// 1e-6 sqft and snapping coordinates to any grid spends more than that budget outright
/// (measured on the project-a zones: closure error up to 1.3e-5 sqft under a 1e-6 ft grid).</item>
/// <item><see cref="Coverage"/> — fixed 1e-6 ft. The shared-edge currency: the coverage simplifier
/// and validator need two rooms' shared vertices to compare exactly equal, which floating overlay
/// output does not guarantee. Used by <see cref="SpaceBoundaryNetwork"/>,
/// <see cref="TakeoffEditability"/>, and TSV read-back validation.</item>
/// </list>
/// A call site picks one by passing it; it never copies the converter.
/// </remarks>
internal static class TakeoffGeometry
{
    /// <summary>Grid of the <see cref="Coverage"/> model: 1e-6 ft.</summary>
    internal const double CoverageScale = 1_000_000;

    internal static readonly GeometryFactory Factory = new(new PrecisionModel(), 0);

    internal static readonly GeometryFactory Coverage = new(new PrecisionModel(CoverageScale));

    internal static Polygon ToPolygon(
        RoomResult room, GeometryFactory? factory = null, string? owner = null) =>
        ToPolygon(room.Polygon, room.Holes, factory, owner ?? room.Id);

    internal static Polygon ToPolygon(
        ResidueResult residue, GeometryFactory? factory = null, string? owner = null) =>
        ToPolygon(residue.Polygon, residue.Holes, factory, owner ?? residue.Id);

    internal static Polygon ToPolygon(
        TakeoffRoomShape room, GeometryFactory? factory = null, string? owner = null) =>
        ToPolygon(room.Outer, room.Holes, factory, owner ?? room.Id);

    internal static Polygon ToPolygon(
        IReadOnlyList<double[]> outer,
        IEnumerable<IReadOnlyList<double[]>> holes,
        GeometryFactory? factory = null,
        string? owner = null)
    {
        var target = factory ?? Factory;
        return target.CreatePolygon(
            Ring(outer, target, owner),
            holes.Select(hole => Ring(hole, target, owner)).ToArray());
    }

    /// <summary>
    /// Builds a closed <see cref="LinearRing"/> from an open or closed loop of model-foot points,
    /// dropping repeated vertices. Rejects non-finite and degenerate input rather than handing a
    /// malformed ring to NTS.
    /// </summary>
    internal static LinearRing Ring(
        IReadOnlyList<double[]> points, GeometryFactory? factory = null, string? owner = null)
    {
        var target = factory ?? Factory;
        string label = owner ?? "loop";
        if (points.Count < 3) throw new InvalidOperationException($"{label} has a degenerate loop");
        var coordinates = new List<Coordinate>(points.Count + 1);
        foreach (var point in points)
        {
            if (point.Length < 2 || !IsFinite(point[0]) || !IsFinite(point[1]))
                throw new InvalidOperationException($"{label} has a non-finite boundary point");
            var coordinate = new Coordinate(point[0], point[1]);
            if (coordinates.Count == 0 || !coordinates[^1].Equals2D(coordinate))
                coordinates.Add(coordinate);
        }
        if (coordinates.Count > 1 && coordinates[0].Equals2D(coordinates[^1]))
            coordinates.RemoveAt(coordinates.Count - 1);
        if (coordinates.Count < 3) throw new InvalidOperationException($"{label} has a degenerate loop");
        coordinates.Add(new Coordinate(coordinates[0].X, coordinates[0].Y));
        return target.CreateLinearRing(coordinates.ToArray());
    }

    /// <summary>Shoelace area; positive = counter-clockwise.</summary>
    internal static double SignedArea(IReadOnlyList<double[]> points)
    {
        double area = 0;
        for (int index = 0; index < points.Count; index++)
        {
            var current = points[index];
            var next = points[(index + 1) % points.Count];
            area += current[0] * next[1] - next[0] * current[1];
        }
        return area / 2;
    }

    /// <summary>Loop vertices of a ring, open (the repeated closing vertex dropped).</summary>
    internal static List<double[]> Points(LineString ring) => ring.Coordinates
        .Take(ring.NumPoints - 1)
        .Select(point => new[] { point.X, point.Y })
        .ToList();

    internal static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
