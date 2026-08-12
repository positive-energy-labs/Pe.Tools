using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Polygonize;
using NetTopologySuite.Operation.Union;

namespace Pe.Revit.Takeoff;

internal sealed record StrictSpaceBoundaryNetworkResult(
    IReadOnlyList<BoundaryCurve> Curves,
    IReadOnlyList<RoomResult> AcceptedRooms,
    IReadOnlyCollection<string> DroppedRoomIds);

// Narrow adapter over the last strict, drop-don't-mangle network from f970088. It accepts the
// current RoomResult contract and returns both the shared linework and reconstructed room loops;
// callers can compare it offline without changing the active takeoff/materialization path.
internal static class StrictSpaceBoundaryNetwork
{
    private const double Scale = 1_000_000;
    private static readonly GeometryFactory Factory = new(new PrecisionModel(Scale));

    internal static StrictSpaceBoundaryNetworkResult Build(
        IEnumerable<RoomResult> rooms,
        double cellFt,
        double simplifyFt,
        Func<double, double, bool>? inkNear = null,
        Action<string>? log = null)
    {
        var source = rooms.ToList();
        var dropped = new HashSet<string>(StringComparer.Ordinal);
        var curves = StrictSpaceBoundaryNetworkCore.BuildCurves(
            source, cellFt, simplifyFt, inkNear, dropped, out var allCurves, log);
        var accepted = Reconstruct(
            source.Where(room => !dropped.Contains(room.Id)), allCurves, dropped, log);
        return new StrictSpaceBoundaryNetworkResult(
            curves, accepted, dropped.OrderBy(id => id, StringComparer.Ordinal).ToArray());
    }

    private static IReadOnlyList<RoomResult> Reconstruct(
        IEnumerable<RoomResult> rooms,
        IReadOnlyList<BoundaryCurve> curves,
        ISet<string> dropped,
        Action<string>? log)
    {
        var source = rooms.ToList();
        if (source.Count == 0 || curves.Count == 0) return [];

        var lines = curves.Select(curve => Factory.CreateLineString([
            new Coordinate(curve.X1, curve.Y1),
            new Coordinate(curve.X2, curve.Y2),
        ])).ToList();
        var polygonizer = new Polygonizer();
        polygonizer.Add(UnaryUnionOp.Union(lines));
        var faces = polygonizer.GetPolygons().Cast<Polygon>().ToList();
        int dangles = polygonizer.GetDangles().Count;
        int cuts = polygonizer.GetCutEdges().Count;
        int invalidRings = polygonizer.GetInvalidRingLines().Count;

        var matches = source.Select(room => (
            Room: room,
            Face: faces.FindIndex(face => face.Covers(
                Factory.CreatePoint(new Coordinate(room.LabelX, room.LabelY)))))).ToList();
        var missing = matches.Where(match => match.Face < 0).ToList();
        foreach (var match in missing) dropped.Add(match.Room.Id);
        var collisions = matches.Where(match => match.Face >= 0).GroupBy(match => match.Face)
            .Where(group => group.Count() > 1).ToList();
        foreach (var collision in collisions)
            foreach (var match in collision) dropped.Add(match.Room.Id);

        var accepted = matches.Where(match => match.Face >= 0 && !dropped.Contains(match.Room.Id))
            .Select(match => FromPolygon(match.Room, faces[match.Face])).ToList();
        string largestFaces = string.Join(",", faces.OrderByDescending(face => face.Area).Take(8)
            .Select(face => face.Area.ToString("F0", CultureInfo.InvariantCulture)));
        log?.Invoke($"[network-adapter] curves={curves.Count} faces={faces.Count} " +
                    $"dangles={dangles} cuts={cuts} invalidRings={invalidRings} " +
                    $"candidates={source.Count} missing={missing.Count} " +
                    $"collisions={collisions.Count} accepted={accepted.Count} " +
                    $"largestFaceSqft={largestFaces}");
        return accepted;
    }

    private static RoomResult FromPolygon(RoomResult source, Polygon polygon)
    {
        var outer = Points(polygon.ExteriorRing);
        if (SignedArea(outer) < 0) outer.Reverse();
        var holes = Enumerable.Range(0, polygon.NumInteriorRings)
            .Select(index => Points(polygon.GetInteriorRingN(index))).ToList();
        foreach (var hole in holes)
            if (SignedArea(hole) > 0) hole.Reverse();

        return new RoomResult {
            Id = source.Id,
            RawSqft = polygon.Area,
            PerimeterFt = polygon.Length,
            LabelX = source.LabelX,
            LabelY = source.LabelY,
            MeanCeilingFt = source.MeanCeilingFt,
            Polygon = outer,
            Holes = holes,
            Flags = [.. source.Flags],
            SplitFrom = source.SplitFrom,
            MergedFrom = source.MergedFrom,
        };
    }

    private static List<double[]> Points(LineString ring) =>
        ring.Coordinates.Take(ring.NumPoints - 1)
            .Select(point => new[] { point.X, point.Y }).ToList();

    private static double SignedArea(IReadOnlyList<double[]> polygon)
    {
        double twiceArea = 0;
        for (int i = 0; i < polygon.Count; i++)
        {
            var a = polygon[i];
            var b = polygon[(i + 1) % polygon.Count];
            twiceArea += a[0] * b[1] - b[0] * a[1];
        }
        return twiceArea / 2;
    }
}
