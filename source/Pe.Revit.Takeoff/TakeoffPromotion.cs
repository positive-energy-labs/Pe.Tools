using NetTopologySuite.Geometries;

namespace Pe.Revit.Takeoff;

internal static class TakeoffPromotion
{
    private const double Epsilon = 1e-7;
    private static readonly GeometryFactory GeometryFactory = new(new PrecisionModel(), 0);

    internal static int ApplyFrameLocal(
        TakeoffResult result, FrameLocalProjectionResult projection, Action<string>? log = null)
    {
        var rejected = projection.Rejected.Select(item => item.Room).ToList();
        result.Rooms = projection.Accepted.Rooms.ToList();
        MoveToRejectedResidue(result, rejected);
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        if (projection.Rejected.Count > 0)
        {
            string reasons = string.Join(" ", projection.Rejected
                .GroupBy(item => item.Reason)
                .OrderBy(group => group.Key)
                .Select(group => $"{group.Key}={group.Count()}"));
            log?.Invoke($"[promotion] frame-local accepted={result.Rooms.Count} " +
                        $"rejected={projection.Rejected.Count} {reasons}");
        }
        return projection.Rejected.Count;
    }

    internal static int MergeOrHoldTinyRooms(
        TakeoffResult result, double minimumSqft, Action<string>? log = null)
    {
        int merged = 0, held = 0;
        foreach (var tiny in result.Rooms.Where(room => room.RawSqft < minimumSqft)
                     .OrderBy(room => room.RawSqft).ThenBy(room => room.Id, StringComparer.Ordinal)
                     .ToList())
        {
            if (!result.Rooms.Contains(tiny)) continue;
            var tinyGeometry = ToPolygon(tiny);
            var neighbors = result.Rooms.Where(room => !ReferenceEquals(room, tiny))
                .Select(room => new {
                    room,
                    geometry = ToPolygon(room),
                })
                .Where(item => item.geometry.Boundary.Intersection(tinyGeometry.Boundary).Length > Epsilon)
                .ToList();
            if (neighbors.Count == 1)
            {
                var target = neighbors[0];
                var union = target.geometry.Union(tinyGeometry);
                if (union is Polygon polygon && polygon.IsValid)
                {
                    var mergedRoom = Clone(target.room, polygon);
                    mergedRoom.MergedFrom = string.Join("+", new[] {
                            target.room.MergedFrom, tiny.Id, tiny.SplitFrom, tiny.MergedFrom,
                        }
                        .Where(value => !string.IsNullOrWhiteSpace(value)));
                    mergedRoom.Flags = target.room.Flags.Concat(tiny.Flags)
                        .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal)
                        .ToList();
                    var candidate = result.Rooms.Where(room => !ReferenceEquals(room, tiny)
                                                               && !ReferenceEquals(room, target.room))
                        .Append(mergedRoom).ToList();
                    if (TakeoffEditability.Evaluate(ToLevel(result, candidate)).IsStrictlyEditable)
                    {
                        int index = result.Rooms.IndexOf(target.room);
                        result.Rooms[index] = mergedRoom;
                        result.Rooms.Remove(tiny);
                        merged++;
                        continue;
                    }
                }
            }
            result.Rooms.Remove(tiny);
            MoveToRejectedResidue(result, [tiny]);
            held++;
        }
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        log?.Invoke($"[promotion] tiny-room policy merged={merged} held={held} " +
                    $"minimum={minimumSqft:F0}sf accepted={result.Rooms.Count}");
        return held;
    }

    internal static int RejectMisalignedExposedRails(
        TakeoffResult result,
        IReadOnlyList<RoomResult> completePartition,
        Func<double, double, double>? distanceToInk,
        Action<string>? log = null)
    {
        if (distanceToInk == null || result.Rooms.Count == 0) return 0;
        var rails = TakeoffEvidenceFidelity.Evaluate(completePartition, distanceToInk);
        var acceptedIds = result.Rooms.Select(room => room.Id).ToHashSet(StringComparer.Ordinal);
        var survivingRails = rails.Where(rail => acceptedIds.Contains(rail.RoomId)).ToList();
        var rejectedIds = survivingRails.Select(rail => rail.RoomId).ToHashSet(StringComparer.Ordinal);
        if (rejectedIds.Count == 0) return 0;
        var rejected = result.Rooms.Where(room => rejectedIds.Contains(room.Id)).ToList();
        result.Rooms.RemoveAll(room => rejectedIds.Contains(room.Id));
        MoveToRejectedResidue(result, rejected);
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
        log?.Invoke($"[promotion] rejected {rejected.Count} evidence-misaligned room(s): " +
                    string.Join(" ", survivingRails.Select(rail =>
                        $"{rail.RoomId}:{rail.BestOffsetFt:+0.000;-0.000}ft")));
        return rejected.Count;
    }

    private static LevelTakeoff ToLevel(TakeoffResult result, IReadOnlyList<RoomResult> rooms) =>
        new(result.LevelName, result.LevelElevation, rooms.Select(room => new TakeoffRoomShape(
            room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
            room.Polygon, room.Holes) { Label = [room.LabelX, room.LabelY] }).ToList());

    private static Polygon ToPolygon(RoomResult room) => GeometryFactory.CreatePolygon(
        Ring(room.Polygon), room.Holes.Select(Ring).ToArray());

    private static LinearRing Ring(IReadOnlyList<double[]> points)
    {
        var coordinates = points.Select(point => new Coordinate(point[0], point[1])).ToList();
        if (!coordinates[0].Equals2D(coordinates[^1])) coordinates.Add(coordinates[0].Copy());
        return GeometryFactory.CreateLinearRing(coordinates.ToArray());
    }

    private static RoomResult Clone(RoomResult room, Polygon polygon) => new()
    {
        Id = room.Id,
        RawSqft = polygon.Area,
        PerimeterFt = polygon.Length,
        LabelX = room.LabelX,
        LabelY = room.LabelY,
        MeanCeilingFt = room.MeanCeilingFt,
        Polygon = Coordinates(polygon.ExteriorRing, true),
        Holes = Enumerable.Range(0, polygon.NumInteriorRings)
            .Select(index => Coordinates(polygon.GetInteriorRingN(index), false)).ToList(),
        Flags = room.Flags.ToList(),
        SplitFrom = room.SplitFrom,
        MergedFrom = room.MergedFrom,
    };

    private static List<double[]> Coordinates(LineString ring, bool counterClockwise)
    {
        var points = ring.Coordinates.Take(ring.NumPoints - 1)
            .Select(point => new[] { point.X, point.Y }).ToList();
        if ((SignedArea(points) > 0) != counterClockwise) points.Reverse();
        return points;
    }

    private static double SignedArea(IReadOnlyList<double[]> points) =>
        Enumerable.Range(0, points.Count).Sum(index =>
        {
            var current = points[index];
            var next = points[(index + 1) % points.Count];
            return current[0] * next[1] - next[0] * current[1];
        }) / 2;

    private static void MoveToRejectedResidue(
        TakeoffResult result, IEnumerable<RoomResult> rejectedRooms)
    {
        foreach (var room in rejectedRooms)
            result.Residues.Add(new ResidueResult {
                Id = room.Id,
                Reason = ResidueReason.Rejected,
                RawSqft = room.RawSqft,
                LabelX = room.LabelX,
                LabelY = room.LabelY,
                MeanCeilingFt = room.MeanCeilingFt,
                Polygon = room.Polygon,
                Holes = room.Holes,
            });
    }
}
