using NetTopologySuite.Coverage;
using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;

namespace Pe.Revit.Takeoff;

internal readonly record struct BoundaryCurve(double X1, double Y1, double X2, double Y2);

// Rooms are one polygonal coverage, not independent shapes. Simplifying them together is the
// essential invariant: an interior edge is represented once and both adjacent rooms receive the
// exact same replacement. There are deliberately no per-room repairs or fallback geometries here.
internal static class SpaceBoundaryNetwork
{
    private const double Scale = 1_000_000;
    private const double Degrees = Math.PI / 180;
    private readonly record struct VertexKey(long X, long Y);
    private readonly record struct SegmentKey(VertexKey A, VertexKey B);
    private sealed class WallEdge
    {
        internal required SegmentKey Key;
        internal required Coordinate A;
        internal required Coordinate B;
        internal required double Length;
        internal required double MidX;
        internal required double MidY;
        internal double EvidenceAngle;
        internal WallLine? Line;
    }
    private sealed class WallLine
    {
        internal required double Nx;
        internal required double Ny;
        internal required double Offset;
    }
    private static readonly GeometryFactory Factory =
        new(new PrecisionModel(Scale));

    internal static IReadOnlyList<BoundaryCurve> Build(IEnumerable<RoomResult> rooms)
    {
        var linework = new List<Geometry>();
        foreach (var room in rooms)
        foreach (var loop in new[] { room.Polygon }.Concat(room.Holes))
        {
            var ring = Ring(loop, room.Id);
            for (int i = 1; i < ring.NumPoints; i++)
            {
                var line = Factory.CreateLineString([ring.GetCoordinateN(i - 1), ring.GetCoordinateN(i)]);
                if (line.Length > 0.01) linework.Add(line);
            }
        }
        if (linework.Count == 0) return [];
        var noded = UnaryUnionOp.Union(linework);
        var result = new List<BoundaryCurve>();
        for (int geometryIndex = 0; geometryIndex < noded.NumGeometries; geometryIndex++)
        {
            var line = (LineString)noded.GetGeometryN(geometryIndex);
            for (int pointIndex = 1; pointIndex < line.NumPoints; pointIndex++)
            {
                var a = line.GetCoordinateN(pointIndex - 1);
                var b = line.GetCoordinateN(pointIndex);
                result.Add(new BoundaryCurve(a.X, a.Y, b.X, b.Y));
            }
        }
        return result;
    }

    internal static void Regularize(
        IReadOnlyList<RoomResult> rooms, double simplifyFt, Action<string>? log = null,
        double cellFt = 0, Func<double, double, bool>? wallAt = null)
    {
        if (!IsFinite(simplifyFt) || simplifyFt < 0)
            throw new ArgumentOutOfRangeException(nameof(simplifyFt));
        if (rooms.Count == 0) return;

        Geometry[] source = rooms.Select(ToGeometry).ToArray();

        if (source.Any(room => !room.IsValid) || !CoverageValidator.IsValid(source))
            throw new InvalidOperationException("Detector output is not a valid shared-edge coverage");
        if (simplifyFt == 0) return;
        var sourceAdjacency = SharedEdges(source);
        double sourceArea = source.Sum(room => room.Area);

        double tolerance = simplifyFt;
        for (int attempt = 0; attempt < 5; attempt++, tolerance /= 2)
        {
            var simplified = CoverageSimplifier.Simplify(source, tolerance);
            if (cellFt > 0 && wallAt != null)
                simplified = AlignToWallEvidence(simplified, cellFt, wallAt, log);
            bool ogcValid = simplified.All(room => room.IsValid);
            bool coverageValid = ogcValid && CoverageValidator.IsValid(simplified);
            bool adjacencyValid = coverageValid && SharedEdges(simplified).SetEquals(sourceAdjacency);
            bool areaValid = Math.Abs(simplified.Sum(room => room.Area) - sourceArea) <= 0.02 * sourceArea;
            Polygon[] polygons = [];
            bool labelsValid = ogcValid && TryReadRooms(simplified, rooms, out polygons);
            if (!ogcValid || !coverageValid || !adjacencyValid || !areaValid || !labelsValid)
            {
                log?.Invoke($"[coverage] rejected tolerance={tolerance:F3}ft " +
                            $"ogc={ogcValid} shared={coverageValid} adjacency={adjacencyValid} " +
                            $"area={areaValid} labels={labelsValid}");
                continue;
            }

            double maxDriftPct = 0;
            for (int i = 0; i < rooms.Count; i++)
            {
                var room = rooms[i];
                var polygon = polygons[i];
                room.Polygon = Points(polygon.ExteriorRing);
                if (SignedArea(room.Polygon) < 0) room.Polygon.Reverse();
                room.Holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => Points(polygon.GetInteriorRingN(index))).ToList();
                foreach (var hole in room.Holes)
                    if (SignedArea(hole) > 0) hole.Reverse();
                room.PerimeterFt = polygon.Length;
                if (room.RawSqft > 0)
                    maxDriftPct = Math.Max(maxDriftPct,
                        100 * Math.Abs(polygon.Area - room.RawSqft) / room.RawSqft);
            }
            log?.Invoke($"[coverage] simplified {rooms.Count} rooms together " +
                        $"tolerance={tolerance:F3}ft maxAreaDrift={maxDriftPct:F1}%");
            return;
        }

        throw new InvalidOperationException("No shared simplification retained every room label");
    }

    // The coverage simplifier owns topology; this stage owns direction. It fits only long edges
    // that stay over straight wall evidence, groups nearby parallel fits into wing-local
    // orientation families, then moves each shared vertex once from all incident fitted lines.
    // Evidence does not own offset: the partition already split the wall band, while a raster
    // ink centroid can land anywhere across the physical wall thickness.
    private static Geometry[] AlignToWallEvidence(
        Geometry[] coverage, double cellFt, Func<double, double, bool> wallAt,
        Action<string>? log)
    {
        var edges = UniqueEdges(coverage).Values
            .Where(edge => edge.Length >= 8)
            .Where(edge => FitEvidence(edge, cellFt, wallAt))
            .OrderByDescending(edge => edge.Length).ToList();
        if (edges.Count == 0) return coverage;

        var families = new List<List<WallEdge>>();
        foreach (var edge in edges)
        {
            var family = families.FirstOrDefault(candidate =>
                AngleDifference(MeanAngle(candidate), edge.EvidenceAngle) <= 6 * Degrees
                && candidate.Any(member => Distance(member.MidX, member.MidY, edge.MidX, edge.MidY) <= 120));
            if (family == null) families.Add([edge]);
            else family.Add(edge);
        }

        int aligned = 0;
        var familyAngles = new List<double>();
        foreach (var family in families)
        {
            double weight = family.Sum(edge => edge.Length);
            if (family.Count < 2 || weight < 16) continue;
            double angle = Math.Round(MeanAngle(family) / (0.5 * Degrees)) * 0.5 * Degrees;
            angle = NormalizeAngle(angle);
            familyAngles.Add(angle);
            double nx = -Math.Sin(angle), ny = Math.Cos(angle);
            foreach (var edge in family)
            {
                edge.Line = new WallLine {
                    Nx = nx, Ny = ny, Offset = nx * edge.MidX + ny * edge.MidY,
                };
                aligned++;
            }
        }
        if (aligned == 0) return coverage;

        var moved = ResolveVertices(edges, cellFt);
        Geometry[] result = coverage.Select(Move).ToArray();
        log?.Invoke($"[coverage] aligned {aligned} wall-supported edges across " +
                    $"{familyAngles.Count} local families " +
                    $"({string.Join(",", familyAngles.Select(angle =>
                        (angle / Degrees).ToString("F1", CultureInfo.InvariantCulture))) }deg)");
        return result;

        Geometry Move(Geometry geometry)
        {
            var polygon = (Polygon)geometry;
            return Factory.CreatePolygon(MoveRing(polygon.ExteriorRing),
                Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(index => MoveRing(polygon.GetInteriorRingN(index))).ToArray());
        }

        LinearRing MoveRing(LineString ring)
        {
            var coordinates = ring.Coordinates.Take(ring.NumPoints - 1)
                .Select(coordinate => moved.GetValueOrDefault(Key(coordinate), coordinate).Copy())
                .ToList();
            coordinates.Add(coordinates[0].Copy());
            return Factory.CreateLinearRing(coordinates.ToArray());
        }
    }

    private static HashSet<(int A, int B)> SharedEdges(IReadOnlyList<Geometry> rooms)
    {
        var result = new HashSet<(int, int)>();
        for (int i = 0; i < rooms.Count; i++)
        for (int j = i + 1; j < rooms.Count; j++)
            if (rooms[i].EnvelopeInternal.Intersects(rooms[j].EnvelopeInternal)
                && rooms[i].Boundary.Intersection(rooms[j].Boundary).Length > 0.01)
                result.Add((i, j));
        return result;
    }

    private static Dictionary<SegmentKey, WallEdge> UniqueEdges(IEnumerable<Geometry> coverage)
    {
        var result = new Dictionary<SegmentKey, WallEdge>();
        foreach (var polygon in coverage.Cast<Polygon>())
        {
            Add(polygon.ExteriorRing);
            for (int i = 0; i < polygon.NumInteriorRings; i++) Add(polygon.GetInteriorRingN(i));
        }
        return result;

        void Add(LineString ring)
        {
            for (int i = 1; i < ring.NumPoints; i++)
            {
                var a = ring.GetCoordinateN(i - 1);
                var b = ring.GetCoordinateN(i);
                var key = Segment(a, b);
                if (result.ContainsKey(key)) continue;
                double length = Distance(a.X, a.Y, b.X, b.Y);
                result[key] = new WallEdge {
                    Key = key, A = a.Copy(), B = b.Copy(), Length = length,
                    MidX = (a.X + b.X) / 2, MidY = (a.Y + b.Y) / 2,
                };
            }
        }
    }

    private static bool FitEvidence(
        WallEdge edge, double cellFt, Func<double, double, bool> wallAt)
    {
        double dx = (edge.B.X - edge.A.X) / edge.Length;
        double dy = (edge.B.Y - edge.A.Y) / edge.Length;
        double nx = -dy, ny = dx;
        int stations = Math.Max(2, (int)Math.Ceiling(edge.Length / cellFt));
        int across = Math.Max(1, (int)Math.Ceiling(0.75 / cellFt));
        var centers = new List<(double X, double Y)>();
        int supported = 0;
        for (int station = 0; station <= stations; station++)
        {
            double t = (double)station / stations;
            double x = edge.A.X + t * (edge.B.X - edge.A.X);
            double y = edge.A.Y + t * (edge.B.Y - edge.A.Y);
            double supportX = 0, supportY = 0;
            int hits = 0;
            for (int offset = -across; offset <= across; offset++)
            {
                double sampleX = x + nx * offset * cellFt;
                double sampleY = y + ny * offset * cellFt;
                if (!wallAt(sampleX, sampleY)) continue;
                supportX += sampleX;
                supportY += sampleY;
                hits++;
            }
            if (hits == 0) continue;
            centers.Add((supportX / hits, supportY / hits));
            supported++;
        }
        if (supported < 0.8 * (stations + 1) || centers.Count < 6) return false;

        double meanX = centers.Average(point => point.X);
        double meanY = centers.Average(point => point.Y);
        double xx = 0, xy = 0, yy = 0;
        foreach (var point in centers)
        {
            double x = point.X - meanX, y = point.Y - meanY;
            xx += x * x; xy += x * y; yy += y * y;
        }
        double angle = NormalizeAngle(0.5 * Math.Atan2(2 * xy, xx - yy));
        double edgeAngle = NormalizeAngle(Math.Atan2(edge.B.Y - edge.A.Y, edge.B.X - edge.A.X));
        if (AngleDifference(angle, edgeAngle) > 12 * Degrees) return false;
        double evidenceNx = -Math.Sin(angle), evidenceNy = Math.Cos(angle);
        if (centers.Max(point => Math.Abs(
                evidenceNx * (point.X - meanX) + evidenceNy * (point.Y - meanY)))
            > Math.Max(0.25, 1.5 * cellFt))
            return false;
        edge.EvidenceAngle = angle;
        return true;
    }

    private static Dictionary<VertexKey, Coordinate> ResolveVertices(
        IEnumerable<WallEdge> edges, double cellFt)
    {
        var incidences = new Dictionary<VertexKey, Dictionary<WallLine, double>>();
        var originals = new Dictionary<VertexKey, Coordinate>();
        foreach (var edge in edges.Where(edge => edge.Line != null))
        foreach (var point in new[] { edge.A, edge.B })
        {
            var key = Key(point);
            originals[key] = point;
            if (!incidences.TryGetValue(key, out var lines)) incidences[key] = lines = [];
            lines[edge.Line!] = lines.GetValueOrDefault(edge.Line!) + edge.Length;
        }

        var result = new Dictionary<VertexKey, Coordinate>();
        double maxShift = Math.Max(0.5, 3 * cellFt);
        foreach (var (key, weighted) in incidences)
        {
            var original = originals[key];
            var lines = weighted.OrderByDescending(pair => pair.Value).Select(pair => pair.Key).ToList();
            Coordinate candidate;
            if (lines.Count >= 2 && TryIntersect(lines, out candidate)) { }
            else candidate = Project(original, lines[0]);
            if (Distance(original.X, original.Y, candidate.X, candidate.Y) <= maxShift)
                result[key] = candidate;
        }
        return result;
    }

    private static bool TryIntersect(IReadOnlyList<WallLine> lines, out Coordinate point)
    {
        double xx = 0, xy = 0, yy = 0, bx = 0, by = 0;
        foreach (var line in lines)
        {
            xx += line.Nx * line.Nx;
            xy += line.Nx * line.Ny;
            yy += line.Ny * line.Ny;
            bx += line.Offset * line.Nx;
            by += line.Offset * line.Ny;
        }
        double determinant = xx * yy - xy * xy;
        if (determinant <= 0.03)
        {
            point = new Coordinate();
            return false;
        }
        point = new Coordinate((bx * yy - by * xy) / determinant,
                               (by * xx - bx * xy) / determinant);
        return true;
    }

    private static Coordinate Project(Coordinate point, WallLine line)
    {
        double shift = line.Offset - line.Nx * point.X - line.Ny * point.Y;
        return new Coordinate(point.X + line.Nx * shift, point.Y + line.Ny * shift);
    }

    private static double MeanAngle(IReadOnlyCollection<WallEdge> edges)
    {
        double x = 0, y = 0;
        foreach (var edge in edges)
        {
            x += edge.Length * Math.Cos(2 * edge.EvidenceAngle);
            y += edge.Length * Math.Sin(2 * edge.EvidenceAngle);
        }
        return NormalizeAngle(0.5 * Math.Atan2(y, x));
    }

    private static double NormalizeAngle(double angle)
    {
        angle %= Math.PI;
        return angle < 0 ? angle + Math.PI : angle;
    }

    private static double AngleDifference(double a, double b)
    {
        double difference = Math.Abs(NormalizeAngle(a) - NormalizeAngle(b));
        return Math.Min(difference, Math.PI - difference);
    }

    private static VertexKey Key(Coordinate point) =>
        new((long)Math.Round(point.X * Scale), (long)Math.Round(point.Y * Scale));

    private static SegmentKey Segment(Coordinate a, Coordinate b)
    {
        var ka = Key(a); var kb = Key(b);
        return ka.X < kb.X || ka.X == kb.X && ka.Y <= kb.Y
            ? new SegmentKey(ka, kb) : new SegmentKey(kb, ka);
    }

    private static double Distance(double ax, double ay, double bx, double by)
    {
        double dx = ax - bx, dy = ay - by;
        return Math.Sqrt(dx * dx + dy * dy);
    }

    private static Geometry ToGeometry(RoomResult room) =>
        Factory.CreatePolygon(
            Ring(room.Polygon, room.Id),
            room.Holes.Select(hole => Ring(hole, room.Id)).ToArray());

    private static bool TryReadRooms(
        IReadOnlyList<Geometry> geometries, IReadOnlyList<RoomResult> rooms,
        out Polygon[] polygons)
    {
        polygons = new Polygon[geometries.Count];
        for (int i = 0; i < geometries.Count; i++)
        {
            var label = Factory.CreatePoint(new Coordinate(rooms[i].LabelX, rooms[i].LabelY));
            if (geometries[i] is not Polygon polygon || !polygon.Contains(label)
                || polygon.Boundary.Distance(label) <= 0.01)
                return false;
            polygons[i] = polygon;
        }
        return true;
    }

    private static LinearRing Ring(IReadOnlyList<double[]> points, string owner)
    {
        if (points.Count < 3) throw new InvalidOperationException($"{owner} has a degenerate loop");
        var coordinates = new List<Coordinate>(points.Count + 1);
        foreach (var point in points)
        {
            if (point.Length < 2 || !IsFinite(point[0]) || !IsFinite(point[1]))
                throw new InvalidOperationException($"{owner} has a non-finite boundary point");
            var coordinate = new Coordinate(point[0], point[1]);
            if (coordinates.Count == 0 || !coordinates[^1].Equals2D(coordinate))
                coordinates.Add(coordinate);
        }
        if (coordinates.Count > 1 && coordinates[0].Equals2D(coordinates[^1]))
            coordinates.RemoveAt(coordinates.Count - 1);
        if (coordinates.Count < 3) throw new InvalidOperationException($"{owner} has a degenerate loop");
        coordinates.Add(coordinates[0].Copy());
        return Factory.CreateLinearRing(coordinates.ToArray());
    }

    private static List<double[]> Points(LineString ring) => ring.Coordinates
        .Take(ring.NumPoints - 1)
        .Select(point => new[] { point.X, point.Y })
        .ToList();

    private static double SignedArea(IReadOnlyList<double[]> points)
    {
        double area = 0;
        for (int i = 0; i < points.Count; i++)
        {
            var a = points[i]; var b = points[(i + 1) % points.Count];
            area += a[0] * b[1] - b[0] * a[1];
        }
        return area / 2;
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);
}
