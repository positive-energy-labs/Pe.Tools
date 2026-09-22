using NetTopologySuite.Coverage;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Linemerge;
using NetTopologySuite.Simplify;
using LineSegment = NetTopologySuite.Geometries.LineSegment;

namespace Pe.Revit.Partition;

/// <summary>Fits each shared chain once. Unshared boundaries and junctions remain fixed.</summary>
internal static class BoundaryShape {
    internal static Geometry[] Regularize(Geometry[] coverage, PartitionInput input) {
        var tolerance = input.Knobs.InkHalfWidthFt * 2;
        if (tolerance <= 0) return coverage;
        var walls = new List<LineSegment>();
        foreach (var band in new[] { input.Knee, input.Header })
            foreach (var element in band.Elements)
                foreach (var piece in element.Pieces)
                    for (var k = 0; k < piece.Length / 2; k++) {
                        var next = (k + 1) % (piece.Length / 2);
                        var segment = new LineSegment(new Coordinate(piece[2*k], piece[2*k+1]),
                            new Coordinate(piece[2*next], piece[2*next+1]));
                        if (segment.Length >= 1) walls.Add(segment);
                    }
        var result = coverage.ToArray();
        for (var i = 0; i < result.Length; i++)
            for (var j = i + 1; j < result.Length; j++) {
                if (!result[i].EnvelopeInternal.Intersects(result[j].EnvelopeInternal)) continue;
                var merger = new LineMerger();
                merger.Add(result[i].Boundary.Intersection(result[j].Boundary));
                foreach (var chain in merger.GetMergedLineStrings().Cast<LineString>()) {
                    if (chain.IsClosed || chain.NumPoints < 3) continue;
                    var fitted = Fit(chain, walls, tolerance, input.Knobs.CloseFt + input.Knobs.InkHalfWidthFt);
                    if (fitted is null) continue;
                    var changes = chain.Coordinates.Skip(1).SkipLast(1)
                        .ToDictionary(c => c, _ => (Coordinate?)null);
                    foreach (var (original, replacement) in fitted) changes[original] = replacement;
                    var a = Replace(result[i], changes);
                    var b = Replace(result[j], changes);
                    if (a is null || b is null || !Corresponds(coverage[i], a) || !Corresponds(coverage[j], b)) continue;
                    var candidate = result.ToArray();
                    candidate[i] = a;
                    candidate[j] = b;
                    if (!CoverageValidator.IsValid(candidate)) continue;
                    // The pair must only exchange area across their shared chain.
                    if (a.Union(b).SymmetricDifference(result[i].Union(result[j])).Area > 1e-6) continue;
                    if (Enumerable.Range(0, result.Length).Any(k => k != i && k != j &&
                        (Adjacent(result[i], result[k]) != Adjacent(a, result[k])
                         || Adjacent(result[j], result[k]) != Adjacent(b, result[k])))) continue;
                    result = candidate;
                }
            }
        return result;
    }

    private static bool Adjacent(Geometry a, Geometry b) =>
        a.EnvelopeInternal.Intersects(b.EnvelopeInternal) && a.Boundary.Intersection(b.Boundary).Length > 0;

    private static bool Corresponds(Geometry before, Geometry after) => after.IsValid && !after.IsEmpty
        && after.Covers(before.InteriorPoint) && before.Covers(after.InteriorPoint)
        && before.Intersection(after).Area >= 0.95 * Math.Max(before.Area, after.Area);

    private static List<(Coordinate Original, Coordinate Replacement)>? Fit(
        LineString chain, List<LineSegment> walls, double tolerance, double reach) {
        var points = ((LineString)DouglasPeuckerSimplifier.Simplify(chain, tolerance)).Coordinates;
        var lines = new LineSegment[points.Length - 1];
        var directions = new bool[lines.Length];
        var supported = false;
        for (var i = 0; i < lines.Length; i++) {
            var chord = new LineSegment(points[i], points[i+1]);
            var direction = Direction(chord, walls, reach);
            directions[i] = direction is not null;
            supported |= direction is not null;
            if (direction is null) { lines[i] = chord; continue; }
            var anchor = i == 0 ? points[0] : i == lines.Length - 1 ? points[^1] : chord.MidPoint;
            lines[i] = new LineSegment(anchor, new Coordinate(anchor.X + direction.X, anchor.Y + direction.Y));
        }
        if (!supported) return null;
        var moved = points.Select(c => c.Copy()).ToArray();
        for (var i = 1; i < points.Length - 1; i++) {
            if (!directions[i-1] || !directions[i]) continue;
            var a = lines[i-1];
            var b = lines[i];
            var cross = (a.P1.X-a.P0.X)*(b.P1.Y-b.P0.Y) - (a.P1.Y-a.P0.Y)*(b.P1.X-b.P0.X);
            // Near-parallel runs have no stable corner intersection.
            if (Math.Abs(cross) < 0.25 * a.Length * b.Length) continue;
            var corner = a.LineIntersection(b);
            if (corner is not null && corner.Distance(points[i]) <= reach) moved[i] = corner;
        }
        var line = chain.Factory.CreateLineString(moved);
        // Simplification keeps its original tolerance. Directional fitting may move only within
        // the existing ink-backing reach; bound both segment interiors and vertices.
        if (!chain.Buffer(reach).Covers(line) || !line.Buffer(reach).Covers(chain)) return null;
        return Enumerable.Range(1, points.Length - 2).Select(i => (points[i], moved[i])).ToList();
    }

    private static Coordinate? Direction(LineSegment chord, List<LineSegment> walls, double reach) {
        Coordinate? best = null;
        var score = 0.0;
        foreach (var wall in walls) {
            var dot = ((chord.P1.X-chord.P0.X)*(wall.P1.X-wall.P0.X)
                + (chord.P1.Y-chord.P0.Y)*(wall.P1.Y-wall.P0.Y)) / (chord.Length * wall.Length);
            if (Math.Abs(dot) < Math.Cos(Math.PI / 8)) continue;
            var distance = wall.Distance(chord.MidPoint);
            if (distance > reach) continue;
            var weight = Math.Min(chord.Length, wall.Length) / (0.1 + distance);
            if (weight <= score) continue;
            score = weight;
            best = new Coordinate((wall.P1.X-wall.P0.X)/wall.Length, (wall.P1.Y-wall.P0.Y)/wall.Length);
        }
        return best;
    }

    private static Geometry? Replace(Geometry geometry, Dictionary<Coordinate, Coordinate?> changes) {
        LinearRing? Ring(LineString ring) {
            var points = ring.Coordinates.Take(ring.NumPoints - 1)
                .Select(c => changes.TryGetValue(c, out var replacement) ? replacement : c)
                .Where(c => c is not null).Cast<Coordinate>().ToList();
            if (points.Count < 3) return null;
            points.Add(points[0]);
            return geometry.Factory.CreateLinearRing(points.ToArray());
        }
        var polygons = new List<Polygon>();
        for (var i = 0; i < geometry.NumGeometries; i++) {
            var polygon = (Polygon)geometry.GetGeometryN(i);
            var shell = Ring(polygon.ExteriorRing);
            var holes = Enumerable.Range(0, polygon.NumInteriorRings).Select(h => Ring(polygon.GetInteriorRingN(h))).ToArray();
            if (shell is null || holes.Any(h => h is null)) return null;
            polygons.Add(geometry.Factory.CreatePolygon(shell, holes!));
        }
        return geometry is Polygon ? polygons[0] : geometry.Factory.CreateMultiPolygon(polygons.ToArray());
    }
}
