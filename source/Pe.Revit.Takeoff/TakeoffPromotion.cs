using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Overlay;
using NetTopologySuite.Operation.OverlayNG;

namespace Pe.Revit.Takeoff;

internal sealed record ZonePromotionDiagnostics(
    int SourceRooms,
    int SharedNetworkStrictRooms,
    int AcceptedRooms,
    int HeldRooms,
    int TinyMerged,
    double PartitionSqft,
    double ZoneSqft,
    double AcceptedSqft,
    double HeldSqft,
    double VoidSqft,
    double ExcludedSqft,
    double InkBackedEdgeFraction,
    double ClosureErrorSqft,
    bool IsStrictlyEditable,
    bool IsContained,
    int SharedEdgePairs,
    int LostSharedEdgePairs,
    IReadOnlyDictionary<string, int> Rejections,
    IReadOnlyDictionary<string, string> RejectionDetails)
{
    internal double HeldFraction => this.PartitionSqft <= 0 ? 0 : this.HeldSqft / this.PartitionSqft;
    internal double VoidFraction => this.PartitionSqft <= 0 ? 0
        : (this.VoidSqft + this.ExcludedSqft) / this.PartitionSqft;
}

internal sealed record ZonePromotionResult(
    TakeoffResult Result,
    ZonePromotionDiagnostics Diagnostics);

internal static class TakeoffPromotion
{
    private const double Epsilon = 1e-7;
    private const double AccountingEpsilonSqft = 1e-6;
    private static readonly GeometryFactory GeometryFactory = new(new PrecisionModel(), 0);

    internal static ZonePromotionResult PromoteZone(
        TakeoffResult source,
        ZoneScope zone,
        TakeoffOptions options,
        Func<double, double, double> distanceToInk,
        Action<string>? log = null)
    {
        if (source == null) throw new ArgumentNullException(nameof(source));
        if (zone == null) throw new ArgumentNullException(nameof(zone));
        if (options == null) throw new ArgumentNullException(nameof(options));
        if (distanceToInk == null) throw new ArgumentNullException(nameof(distanceToInk));
        var timer = System.Diagnostics.Stopwatch.StartNew();
        long lastMilliseconds = 0;
        void Mark(string stage)
        {
            long elapsed = timer.ElapsedMilliseconds;
            log?.Invoke($"[promotion] stage={stage} ms={elapsed - lastMilliseconds} total={elapsed}");
            lastMilliseconds = elapsed;
        }

        var zoneGeometry = zone.ExactGeometry();
        Mark("zone-geometry");
        var result = Clone(source);
        double partitionSqft = result.DomainSqft + result.ClaimedWallSqft;
        // The detector's selected partition is the disposition authority. Every downstream
        // regularizer/projector may either improve a room or hold that exact source room whole.
        var completePartition = result.Rooms.Select(room => Clone(room)).ToList();
        SpaceBoundaryNetwork.Regularize(result.Rooms, options.BoundarySimplifyFt, log);
        NormalizeRoomMeasures(result.Rooms);
        var evidencePartition = result.Rooms.Select(room => Clone(room)).ToList();
        int sharedNetworkStrictRooms = TakeoffEditability.Evaluate(
            ToLevel(result, result.Rooms)).Rooms.Count(room => room.IsStrictlyEditable);
        Mark("shared-network");
        var projection = FrameLocalProjector.Project(result);
        Mark("frame-projector");
        var rejections = projection.Rejected
            .GroupBy(item => $"frame:{item.Reason}")
            .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        var rejectionDetails = projection.Rejected.ToDictionary(
            item => item.Room.Id,
            item => $"frame:{item.Reason} {item.Detail}",
            StringComparer.Ordinal);

        ApplyFrameLocal(result, projection, log);
        int beforeTiny = result.Rooms.Count;
        int heldTiny = options.MinimumPromotedRoomSqft > 0
            ? MergeOrHoldTinyRooms(result, options.MinimumPromotedRoomSqft, log)
            : 0;
        int tinyMerged = beforeTiny - result.Rooms.Count - heldTiny;
        if (heldTiny > 0) rejections["tiny:held"] = heldTiny;
        Mark("tiny");

        int evidenceRejected = RejectMisalignedExposedRails(
            result, evidencePartition, distanceToInk, log);
        if (evidenceRejected > 0) rejections["evidence:misaligned"] = evidenceRejected;
        Mark("evidence");

        int scopeRejected = RejectOutsideZone(result, zoneGeometry);
        if (scopeRejected > 0) rejections["scope:outside"] = scopeRejected;
        Mark("scope");

        var shared = EnforceSharedEdges(result, completePartition);
        if (shared.LostPairs > 0) rejections["shared:lost"] = shared.LostPairs;
        Mark("shared-audit");

        int editabilityRejected = RejectUneditable(result);
        if (editabilityRejected > 0) rejections["editability:final"] = editabilityRejected;
        Mark("editability");

        int heldRooms = result.Residues.Count(residue => residue.Reason == ResidueReason.Rejected);
        RestoreHeldSourceGeometry(result, completePartition);
        RebuildResiduesInsideZone(result, zoneGeometry);
        Mark("disposition");

        double acceptedSqft = result.Rooms.Sum(room => room.RawSqft);
        double heldSqft = result.Residues
            .Where(residue => residue.Reason == ResidueReason.Rejected)
            .Sum(residue => residue.RawSqft);
        double voidSqft = result.Residues
            .Where(residue => residue.Reason is ResidueReason.Border or ResidueReason.Crumb)
            .Sum(residue => residue.RawSqft);
        double excludedSqft = result.Residues
            .Where(residue => residue.Reason == ResidueReason.Excluded)
            .Sum(residue => residue.RawSqft);
        double closureError = Math.Abs(
            acceptedSqft + heldSqft + voidSqft + excludedSqft - zoneGeometry.Area);
        bool strict = TakeoffEditability.Evaluate(ToLevel(result, result.Rooms)).IsStrictlyEditable;
        bool contained = result.Rooms.All(room =>
            PolygonDifference(ToPolygon(room), zoneGeometry).Area <= Epsilon);
        if (!strict || !contained || closureError > AccountingEpsilonSqft)
            throw new InvalidOperationException(
                $"zone promotion violated a binding law: strict={strict} contained={contained} " +
                $"closure={closureError:F9}sf");
        var diagnostics = new ZonePromotionDiagnostics(
            source.Rooms.Count,
            sharedNetworkStrictRooms,
            result.Rooms.Count,
            heldRooms,
            tinyMerged,
            partitionSqft,
            zoneGeometry.Area,
            acceptedSqft,
            heldSqft,
            voidSqft,
            excludedSqft,
            TakeoffEvidenceFidelity.BoundarySupportFraction(result.Rooms, distanceToInk),
            closureError,
            strict,
            contained,
            shared.PreservedPairs,
            shared.LostPairs,
            new SortedDictionary<string, int>(rejections, StringComparer.Ordinal),
            new SortedDictionary<string, string>(rejectionDetails, StringComparer.Ordinal));
        return new ZonePromotionResult(result, diagnostics);
    }

    private static void NormalizeRoomMeasures(IEnumerable<RoomResult> rooms)
    {
        foreach (var room in rooms)
        {
            var polygon = ToPolygon(room);
            room.RawSqft = polygon.Area;
            room.PerimeterFt = polygon.Length;
        }
    }

    private static void RestoreHeldSourceGeometry(
        TakeoffResult result, IReadOnlyList<RoomResult> sourceRooms)
    {
        var sourceById = sourceRooms.ToDictionary(room => room.Id, StringComparer.Ordinal);
        foreach (var residue in result.Residues
                     .Where(item => item.Reason == ResidueReason.Rejected))
        {
            if (!sourceById.TryGetValue(residue.Id, out var source)) continue;
            residue.RawSqft = ToPolygon(source).Area;
            residue.LabelX = source.LabelX;
            residue.LabelY = source.LabelY;
            residue.MeanCeilingFt = source.MeanCeilingFt;
            residue.Polygon = source.Polygon.Select(point => new[] { point[0], point[1] }).ToList();
            residue.Holes = source.Holes.Select(hole => hole
                .Select(point => new[] { point[0], point[1] }).ToList()).ToList();
        }
    }

    private static int RejectOutsideZone(TakeoffResult result, Geometry zone)
    {
        var rejected = result.Rooms.Where(room =>
            PolygonDifference(ToPolygon(room), zone).Area > Epsilon).ToList();
        if (rejected.Count == 0) return 0;
        result.Rooms.RemoveAll(rejected.Contains);
        MoveToRejectedResidue(result, rejected);
        return rejected.Count;
    }

    private static (int PreservedPairs, int LostPairs) EnforceSharedEdges(
        TakeoffResult result, IReadOnlyList<RoomResult> source)
    {
        var sourceGeometry = source.ToDictionary(room => room.Id, ToPolygon, StringComparer.Ordinal);
        var accepted = result.Rooms.ToDictionary(room => room.Id, ToPolygon, StringComparer.Ordinal);
        var lostIds = new HashSet<string>(StringComparer.Ordinal);
        int preserved = 0, lost = 0;
        var ids = accepted.Keys.Where(sourceGeometry.ContainsKey).OrderBy(id => id, StringComparer.Ordinal).ToList();
        for (int left = 0; left < ids.Count; left++)
        for (int right = left + 1; right < ids.Count; right++)
        {
            string a = ids[left], b = ids[right];
            double expected = Intersection(
                sourceGeometry[a].Boundary, sourceGeometry[b].Boundary).Length;
            if (expected <= Epsilon) continue;
            double actual = Intersection(accepted[a].Boundary, accepted[b].Boundary).Length;
            if (actual > Epsilon) preserved++;
            else
            {
                lost++;
                lostIds.Add(a);
                lostIds.Add(b);
            }
        }
        if (lostIds.Count > 0)
        {
            var rejected = result.Rooms.Where(room => lostIds.Contains(room.Id)).ToList();
            result.Rooms.RemoveAll(room => lostIds.Contains(room.Id));
            MoveToRejectedResidue(result, rejected);
        }
        return (preserved, lost);
    }

    private static int RejectUneditable(TakeoffResult result)
    {
        if (result.Rooms.Count == 0) return 0;
        var rejectedIds = TakeoffEditability.Evaluate(ToLevel(result, result.Rooms)).Rooms
            .Where(room => !room.IsStrictlyEditable)
            .Select(room => room.RoomId).ToHashSet(StringComparer.Ordinal);
        if (rejectedIds.Count == 0) return 0;
        var rejected = result.Rooms.Where(room => rejectedIds.Contains(room.Id)).ToList();
        result.Rooms.RemoveAll(room => rejectedIds.Contains(room.Id));
        MoveToRejectedResidue(result, rejected);
        return rejected.Count;
    }

    private static void RebuildResiduesInsideZone(TakeoffResult result, Geometry zone)
    {
        Geometry available = result.Rooms.Count == 0
            ? zone.Copy()
            : PolygonDifference(zone, OverlayNGRobust.Union(
                result.Rooms.Select(room => (Geometry)ToPolygon(room))));
        var rebuilt = new List<ResidueResult>();
        foreach (var residue in result.Residues
                     .OrderBy(item => item.Reason == ResidueReason.Rejected ? 0 : 1)
                     .ThenBy(item => item.Id, StringComparer.Ordinal))
        {
            var geometry = PolygonIntersection(ToGeometry(residue), available);
            AddResidues(rebuilt, residue.Id, residue.Reason, geometry, residue.MeanCeilingFt);
            if (!geometry.IsEmpty) available = PolygonDifference(available, geometry);
        }
        AddResidues(rebuilt, "ZONE-EXCLUDED", ResidueReason.Excluded, available, 0);
        result.Residues = rebuilt;
        result.DomainSqft = zone.Area;
        result.ClaimedWallSqft = 0;
        result.ExcludedResidueSqft = 0;
        result.TotalSqft = result.Rooms.Sum(room => room.RawSqft);
    }

    private static Geometry ToGeometry(ResidueResult residue) => GeometryFactory.CreatePolygon(
        Ring(residue.Polygon), residue.Holes.Select(Ring).ToArray());

    private static Geometry Intersection(Geometry left, Geometry right) =>
        OverlayNGRobust.Overlay(left, right, SpatialFunction.Intersection);

    private static Geometry PolygonIntersection(Geometry left, Geometry right) =>
        Polygonal(OverlayNGRobust.Overlay(
            Polygonal(left), Polygonal(right), SpatialFunction.Intersection));

    private static Geometry PolygonDifference(Geometry left, Geometry right) =>
        Polygonal(OverlayNGRobust.Overlay(
            Polygonal(left), Polygonal(right), SpatialFunction.Difference));

    private static Geometry Polygonal(Geometry geometry)
    {
        var polygons = PolygonParts(geometry).Cast<Geometry>().ToList();
        return polygons.Count switch {
            0 => GeometryFactory.CreatePolygon(),
            1 => polygons[0],
            _ => GeometryFactory.BuildGeometry(polygons),
        };
    }

    private static void AddResidues(
        ICollection<ResidueResult> target, string id, ResidueReason reason,
        Geometry geometry, double meanCeilingFt)
    {
        var polygons = PolygonParts(geometry).Where(polygon => polygon.Area > Epsilon).ToList();
        for (int index = 0; index < polygons.Count; index++)
        {
            var polygon = polygons[index];
            var label = polygon.InteriorPoint.Coordinate;
            target.Add(new ResidueResult {
                Id = polygons.Count == 1 ? id : $"{id}~{index + 1}",
                Reason = reason,
                RawSqft = polygon.Area,
                LabelX = label.X,
                LabelY = label.Y,
                MeanCeilingFt = meanCeilingFt,
                Polygon = Coordinates(polygon.ExteriorRing, true),
                Holes = Enumerable.Range(0, polygon.NumInteriorRings)
                    .Select(ring => Coordinates(polygon.GetInteriorRingN(ring), false)).ToList(),
            });
        }
    }

    private static IEnumerable<Polygon> PolygonParts(Geometry geometry)
    {
        if (geometry is Polygon polygon) yield return polygon;
        else if (geometry is GeometryCollection collection)
            for (int index = 0; index < collection.NumGeometries; index++)
            foreach (var part in PolygonParts(collection.GetGeometryN(index))) yield return part;
    }

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
        var acceptedIds = result.Rooms.Select(room => room.Id).ToHashSet(StringComparer.Ordinal);
        var survivingRails = TakeoffEvidenceFidelity.Evaluate(
            completePartition, acceptedIds, distanceToInk);
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

    private static RoomResult Clone(RoomResult room) => new()
    {
        Id = room.Id,
        RawSqft = room.RawSqft,
        PerimeterFt = room.PerimeterFt,
        LabelX = room.LabelX,
        LabelY = room.LabelY,
        MeanCeilingFt = room.MeanCeilingFt,
        Polygon = room.Polygon.Select(point => new[] { point[0], point[1] }).ToList(),
        Holes = room.Holes.Select(hole => hole
            .Select(point => new[] { point[0], point[1] }).ToList()).ToList(),
        Flags = room.Flags.ToList(),
        SplitFrom = room.SplitFrom,
        MergedFrom = room.MergedFrom,
    };

    private static TakeoffResult Clone(TakeoffResult source) => new()
    {
        LevelName = source.LevelName,
        LevelElevation = source.LevelElevation,
        Source = source.Source,
        Rooms = source.Rooms.Select(room => Clone(room)).ToList(),
        Residues = source.Residues.Select(residue => new ResidueResult {
            Id = residue.Id,
            Reason = residue.Reason,
            RawSqft = residue.RawSqft,
            LabelX = residue.LabelX,
            LabelY = residue.LabelY,
            MeanCeilingFt = residue.MeanCeilingFt,
            Polygon = residue.Polygon.Select(point => new[] { point[0], point[1] }).ToList(),
            Holes = residue.Holes.Select(hole => hole
                .Select(point => new[] { point[0], point[1] }).ToList()).ToList(),
        }).ToList(),
        TotalSqft = source.TotalSqft,
        DomainSqft = source.DomainSqft,
        ClaimedWallSqft = source.ClaimedWallSqft,
        ExcludedResidueSqft = source.ExcludedResidueSqft,
        ProfileProvenance = source.ProfileProvenance,
        LevelFlags = source.LevelFlags.ToList(),
        SeedViewA = source.SeedViewA,
        SeedViewB = source.SeedViewB,
        EvidenceView = source.EvidenceView,
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
