using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;

namespace Pe.Revit.Takeoff;

internal sealed record MisalignedExposedRail(
    string RoomId,
    double LengthFt,
    double DirectSupport,
    double BestSupport,
    double BestOffsetFt);

internal static class TakeoffEvidenceFidelity
{
    private const double SharedBoundaryToleranceFt = 0.08;
    private const double MinimumFragmentFt = 5;
    private const double EndpointTrimFt = 0.5;
    private const double SampleStepFt = 0.25;
    private const double OffsetStepFt = 0.125;
    private const double MaximumOffsetFt = 1.5;
    private const double Epsilon = 1e-7;
    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 0);

    internal static IReadOnlyList<MisalignedExposedRail> Evaluate(
        IReadOnlyList<RoomResult> rooms,
        Func<double, double, double> distanceToInk)
    {
        var polygons = rooms.ToDictionary(room => room.Id, ToPolygon, StringComparer.Ordinal);
        var result = new List<MisalignedExposedRail>();
        foreach (var room in rooms)
        {
            var otherBoundaries = polygons
                .Where(item => item.Key != room.Id)
                .Select(item => (Geometry)item.Value.Boundary.Buffer(SharedBoundaryToleranceFt))
                .ToList();
            var shared = otherBoundaries.Count == 0
                ? null
                : UnaryUnionOp.Union(otherBoundaries);
            foreach (var edge in Edges(polygons[room.Id]))
            foreach (var fragment in Lines(shared == null ? edge : edge.Difference(shared)))
            {
                if (fragment.Length < MinimumFragmentFt) continue;
                var score = Score(fragment, distanceToInk);
                if (score == null) continue;
                var (direct, meanDirect, best, offset) = score.Value;
                if (best < 2d / 3 || direct > 1d / 6 || best - direct < 0.5
                    || meanDirect < 0.5
                    || Math.Abs(offset) < 0.25 || Math.Abs(offset) > 0.75)
                    continue;
                result.Add(new MisalignedExposedRail(
                    room.Id, fragment.Length, direct, best, offset));
            }
        }
        return result.OrderBy(item => item.RoomId, StringComparer.Ordinal)
            .ThenByDescending(item => item.LengthFt).ToList();
    }

    private static (double Direct, double MeanDirect, double Best, double Offset)? Score(
        LineString line,
        Func<double, double, double> distanceToInk)
    {
        double available = line.Length - 2 * EndpointTrimFt;
        if (available <= Epsilon) return null;
        int count = Math.Max(2, (int)Math.Floor(available / SampleStepFt) + 1);
        var start = line.GetCoordinateN(0);
        var end = line.GetCoordinateN(line.NumPoints - 1);
        double dx = end.X - start.X, dy = end.Y - start.Y;
        double length = Math.Sqrt(dx * dx + dy * dy);
        if (length <= Epsilon) return null;
        double nx = -dy / length, ny = dx / length;

        (double support, double meanDistance) Support(double offset)
        {
            int hits = 0;
            double totalDistance = 0;
            for (int index = 0; index < count; index++)
            {
                double distance = EndpointTrimFt + available * index / (count - 1);
                var coordinate = PointAlong(line, distance);
                double inkDistance = distanceToInk(
                    coordinate.X + nx * offset, coordinate.Y + ny * offset);
                totalDistance += inkDistance;
                if (inkDistance <= 0.25 + Epsilon) hits++;
            }
            return ((double)hits / count, totalDistance / count);
        }

        var directScore = Support(0);
        double direct = directScore.support, best = direct, bestOffset = 0;
        int steps = (int)Math.Round(MaximumOffsetFt / OffsetStepFt);
        for (int step = -steps; step <= steps; step++)
        {
            double offset = step * OffsetStepFt;
            double support = Support(offset).support;
            if (support > best + Epsilon
                || Math.Abs(support - best) <= Epsilon
                && Math.Abs(offset) < Math.Abs(bestOffset))
            {
                best = support;
                bestOffset = offset;
            }
        }
        return (direct, directScore.meanDistance, best, bestOffset);
    }

    private static Coordinate PointAlong(LineString line, double distance)
    {
        var coordinates = line.Coordinates;
        for (int index = 1; index < coordinates.Length; index++)
        {
            double segment = coordinates[index - 1].Distance(coordinates[index]);
            if (distance > segment) { distance -= segment; continue; }
            double t = segment <= Epsilon ? 0 : distance / segment;
            return new Coordinate(
                coordinates[index - 1].X + t * (coordinates[index].X - coordinates[index - 1].X),
                coordinates[index - 1].Y + t * (coordinates[index].Y - coordinates[index - 1].Y));
        }
        return coordinates[^1];
    }

    private static IEnumerable<LineString> Edges(Polygon polygon)
    {
        foreach (var edge in RingEdges(polygon.ExteriorRing)) yield return edge;
        for (int index = 0; index < polygon.NumInteriorRings; index++)
            foreach (var edge in RingEdges(polygon.GetInteriorRingN(index))) yield return edge;
    }

    private static IEnumerable<LineString> RingEdges(LineString ring)
    {
        var points = CollapseCollinear(ring.Coordinates.Take(ring.NumPoints - 1).ToList());
        for (int index = 0; index < points.Count; index++)
            yield return Factory.CreateLineString([points[index], points[(index + 1) % points.Count]]);
    }

    private static List<Coordinate> CollapseCollinear(List<Coordinate> points)
    {
        bool changed;
        do
        {
            changed = false;
            for (int index = 0; index < points.Count && points.Count >= 3; index++)
            {
                var previous = points[(index + points.Count - 1) % points.Count];
                var current = points[index];
                var next = points[(index + 1) % points.Count];
                double ax = current.X - previous.X, ay = current.Y - previous.Y;
                double bx = next.X - current.X, by = next.Y - current.Y;
                double cross = Math.Abs(ax * by - ay * bx);
                double lengths = Math.Sqrt(ax * ax + ay * ay) * Math.Sqrt(bx * bx + by * by);
                if (ax * bx + ay * by > 0 && cross <= Math.Sin(0.25 * Math.PI / 180) * lengths)
                {
                    points.RemoveAt(index);
                    changed = true;
                    break;
                }
            }
        } while (changed);
        return points;
    }

    private static IEnumerable<LineString> Lines(Geometry geometry)
    {
        if (geometry is LineString line) yield return line;
        else
            for (int index = 0; index < geometry.NumGeometries; index++)
                foreach (var child in Lines(geometry.GetGeometryN(index))) yield return child;
    }

    private static Polygon ToPolygon(RoomResult room) => Factory.CreatePolygon(
        Ring(room.Polygon), room.Holes.Select(Ring).ToArray());

    private static LinearRing Ring(IReadOnlyList<double[]> points)
    {
        var coordinates = points.Select(point => new Coordinate(point[0], point[1])).ToList();
        if (!coordinates[0].Equals2D(coordinates[^1])) coordinates.Add(coordinates[0].Copy());
        return Factory.CreateLinearRing(coordinates.ToArray());
    }
}
