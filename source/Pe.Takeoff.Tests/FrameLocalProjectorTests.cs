using NetTopologySuite.Geometries;
using NetTopologySuite.Algorithm.Distance;
using NetTopologySuite.Operation.Union;
using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

[TestFixture]
public sealed class FrameLocalProjectorTests
{
    private static readonly GeometryFactory Factory = new();

    [Test]
    public void Projects_rotated_adjacent_rooms_without_hardcoded_frames()
    {
        var left = Rect("left", 0, 0, 10, 8, 17, 4, 4);
        left.Flags.Add("source-flag");
        left.SplitFrom = "parent";
        var right = Rect("right", 10, 0, 20, 8, 17, 14, 4);
        right.MergedFrom = "child";

        var result = FrameLocalProjector.Project(Takeoff(left, right));

        Assert.Multiple(() =>
        {
            Assert.That(result.Rejected, Is.Empty);
            Assert.That(result.Accepted.Rooms, Has.Count.EqualTo(2));
            Assert.That(result.Accepted.Rooms[0].Id, Is.EqualTo("left"));
            Assert.That(result.Accepted.Rooms[0].Flags, Is.EqualTo(new[] { "source-flag" }));
            Assert.That(result.Accepted.Rooms[0].SplitFrom, Is.EqualTo("parent"));
            Assert.That(result.Accepted.Rooms[1].MergedFrom, Is.EqualTo("child"));
            Assert.That(result.Accepted.Rooms.All(IsOrthogonal), Is.True);
            Assert.That(Editability(result.Accepted.Rooms.ToArray()).IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Rotated_room_with_hole_preserves_topology_and_ring_orientation()
    {
        const double degrees = 27;
        var room = Room("donut",
            new[] { (0d, 0d), (20d, 0d), (20d, 20d), (0d, 20d) }
                .Select(point => RotatePoint(0, 0, degrees, point.Item1, point.Item2)),
            RotatePoint(0, 0, degrees, 3, 3).x,
            RotatePoint(0, 0, degrees, 3, 3).y);
        room.Holes.Add(new[] { (6d, 6d), (6d, 14d), (14d, 14d), (14d, 6d) }
            .Select(point => RotatePoint(0, 0, degrees, point.Item1, point.Item2))
            .Select(point => new[] { point.x, point.y }).ToList());
        var sourceGeometry = ToPolygon(room);
        room.RawSqft = sourceGeometry.Area;
        room.PerimeterFt = sourceGeometry.Length;

        var result = FrameLocalProjector.Project(Takeoff(room));
        var accepted = result.Accepted.Rooms.Single();
        var polygon = ToPolygon(accepted);

        Assert.Multiple(() =>
        {
            Assert.That(result.Rejected, Is.Empty);
            Assert.That(polygon.NumInteriorRings, Is.EqualTo(1));
            Assert.That(polygon.Area, Is.EqualTo(336).Within(1e-6));
            Assert.That(SignedArea(accepted.Polygon), Is.GreaterThan(0));
            Assert.That(SignedArea(accepted.Holes.Single()), Is.LessThan(0));
            Assert.That(polygon.Covers(Factory.CreatePoint(
                new Coordinate(accepted.LabelX, accepted.LabelY))), Is.True);
            Assert.That(Editability(accepted).IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Skewed_shared_edge_becomes_canonically_editable_in_the_derived_frame()
    {
        const double degrees = 31;
        var left = Room("left", new[] { (0.1, 0d), (10d, 0d), (10.2, 10d), (0d, 10.1) }
            .Select(point => RotatePoint(0, 0, degrees, point.Item1, point.Item2)),
            RotatePoint(0, 0, degrees, 5, 5).x, RotatePoint(0, 0, degrees, 5, 5).y);
        var right = Room("right", new[] { (10d, 0d), (20.1, -0.1), (20d, 10d), (10.2, 10d) }
            .Select(point => RotatePoint(0, 0, degrees, point.Item1, point.Item2)),
            RotatePoint(0, 0, degrees, 15, 5).x, RotatePoint(0, 0, degrees, 15, 5).y);

        var result = FrameLocalProjector.Project(Takeoff(left, right));

        Assert.Multiple(() => {
            Assert.That(Editability(left, right).IsStrictlyEditable, Is.False);
            Assert.That(result.Rejected, Is.Empty);
            Assert.That(Editability(result.Accepted.Rooms.ToArray()).IsStrictlyEditable, Is.True);
            var polygons = result.Accepted.Rooms.Select(ToPolygon).ToList();
            Assert.That(polygons[0].Boundary.Intersection(polygons[1].Boundary).Length,
                Is.GreaterThan(9.8));
        });
    }

    [Test]
    public void Holds_mixed_frame_room_instead_of_falling_back_to_raw_geometry()
    {
        var frameA = Rect("a", -30, -10, -10, 10, 0, -20, 0);
        var frameB = Rect("b", 20, -10, 40, 10, 31, 30, 0);
        double radians = 31 * Math.PI / 180;
        var mixed = Room("mixed", new[]
        {
            (0d, 20d), (10, 20),
            (10 + 10 * Math.Cos(radians), 20 + 10 * Math.Sin(radians)),
            (10 * Math.Cos(radians), 20 + 10 * Math.Sin(radians))
        }, 5 + 5 * Math.Cos(radians), 20 + 5 * Math.Sin(radians));

        var result = FrameLocalProjector.Project(Takeoff(frameA, frameB, mixed));

        Assert.Multiple(() =>
        {
            Assert.That(result.Accepted.Rooms.Select(x => x.Id), Does.Not.Contain("mixed"));
            Assert.That(result.Rejected.Single(x => x.Room.Id == "mixed").Reason,
                Is.AnyOf(FrameLocalRejectionReason.MixedFrame, FrameLocalRejectionReason.NoCoherentFrame));
        });
    }

    [Test]
    public void Adjacent_outputs_form_a_valid_non_overlapping_coverage()
    {
        var result = FrameLocalProjector.Project(Takeoff(
            Rect("one", 0, 0, 9, 7, 23, 4, 3),
            Rect("two", 9, 0, 18, 7, 23, 13, 3),
            Rect("three", 0, 7, 18, 13, 23, 9, 10)));
        var polygons = result.Accepted.Rooms.Select(ToPolygon).Cast<Geometry>().ToList();
        var union = UnaryUnionOp.Union(polygons);

        Assert.Multiple(() =>
        {
            Assert.That(result.Rejected, Is.Empty);
            Assert.That(polygons.Sum(x => x.Area), Is.EqualTo(union.Area).Within(1e-7));
            Assert.That(polygons[0].Boundary.Intersection(polygons[1].Boundary).Length, Is.GreaterThan(6.9));
            Assert.That(Editability(result.Accepted.Rooms.ToArray()).IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Near_boundary_drift_limit_keeps_shared_edge_labels_and_strict_editability()
    {
        var left = Room("left", new[] { (0d, 0d), (10d, 0d), (12.8d, 20d), (0d, 20d) }, 5, 10);
        var right = Room("right", new[]
            { (10d, 0d), (22.8d, 0d), (22.8d, 20d), (12.8d, 20d) }, 18, 10);

        var result = FrameLocalProjector.Project(Takeoff(left, right));
        var projected = result.Accepted.Rooms.Select(ToPolygon).ToList();
        var source = new[] { ToPolygon(left), ToPolygon(right) };
        var drifts = projected.Select((polygon, index) => DiscreteHausdorffDistance.Distance(
            source[index].Boundary, polygon.Boundary)).ToList();

        Assert.Multiple(() =>
        {
            Assert.That(result.Rejected, Is.Empty);
            Assert.That(drifts.Max(), Is.GreaterThan(1.2).And.LessThanOrEqualTo(1.5 + 1e-7));
            Assert.That(projected[0].Intersection(projected[1]).Area, Is.LessThan(1e-7));
            Assert.That(projected[0].Boundary.Intersection(projected[1].Boundary).Length,
                Is.GreaterThan(19.9));
            Assert.That(result.Accepted.Rooms.Select((room, index) => projected[index].Covers(
                Factory.CreatePoint(new Coordinate(room.LabelX, room.LabelY)))), Is.All.True);
            Assert.That(Editability(result.Accepted.Rooms.ToArray()).IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Same_frame_source_overlap_holds_every_involved_room_whole()
    {
        var first = Rect("first", 0, 0, 10, 10, 0, 5, 5);
        var second = Rect("second", 9, 0, 19, 10, 0, 14, 5);
        var clear = Rect("clear", 30, 0, 40, 10, 0, 35, 5);

        var result = FrameLocalProjector.Project(Takeoff(first, second, clear));

        Assert.Multiple(() => {
            Assert.That(result.Accepted.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "clear" }));
            Assert.That(result.Rejected.Select(room => room.Room.Id),
                Is.EquivalentTo(new[] { "first", "second" }));
            Assert.That(result.Rejected.Select(room => room.Reason),
                Is.All.EqualTo(FrameLocalRejectionReason.AmbiguousSourceOverlap));
            Assert.That(result.Rejected.Single(room => room.Room.Id == "first").Room.Polygon,
                Is.EqualTo(first.Polygon));
            Assert.That(result.Rejected.Single(room => room.Room.Id == "second").Room.Polygon,
                Is.EqualTo(second.Polygon));
        });
    }

    [Test]
    public void Rejects_label_outside_and_area_drift_as_whole_rooms()
    {
        var good = Rect("good", -20, 0, -10, 10, 0, -15, 5);
        var labelOutside = Rect("label", 0, 0, 10, 10, 0, 20, 20);
        var drift = Room("drift", new[]
        {
            (20d, 0d), (30, 0), (30, 10), (25, 15), (20, 10)
        }, 25, 5);

        var result = FrameLocalProjector.Project(Takeoff(good, labelOutside, drift));

        Assert.Multiple(() =>
        {
            Assert.That(result.Accepted.Rooms.Select(x => x.Id), Is.EquivalentTo(new[] { "good" }));
            Assert.That(result.Rejected.Single(x => x.Room.Id == "label").Reason,
                Is.EqualTo(FrameLocalRejectionReason.LabelOutside));
            Assert.That(result.Rejected.Single(x => x.Room.Id == "drift").Reason,
                Is.EqualTo(FrameLocalRejectionReason.AreaDrift));
            Assert.That(result.Rejected.Single(x => x.Room.Id == "drift").Room.Polygon,
                Has.Count.EqualTo(drift.Polygon.Count));
        });
    }

    [Test]
    public void Canonical_output_preserves_shared_network_nodes()
    {
        var room = Room("room", new[]
        {
            (0d, 0d), (4d, 0d), (8d, 0d), (12d, 0d),
            (12d, 5d), (12d, 10d), (0d, 10d), (0d, 5d)
        }, 3, 4);

        var result = FrameLocalProjector.Project(Takeoff(room));

        Assert.Multiple(() =>
        {
            Assert.That(result.Rejected, Is.Empty);
            var audit = Editability(result.Accepted.Rooms.ToArray());
            Assert.That(audit.IsStrictlyEditable, Is.True);
            Assert.That(result.Accepted.Rooms.Single().Polygon, Has.Count.GreaterThan(4));
            Assert.That(audit.Rooms.Single().CornerCount, Is.EqualTo(4));
        });
    }

    [Test]
    public void Retries_drift_rejection_in_its_local_neighborhood_without_relaxing_gates()
    {
        var room = Room("room", new[]
        {
            (452.167547, 692.009248), (451.667547, 686.259248),
            (445.667547, 686.009248), (446.167547, 677.509248),
            (444.417547, 674.759248), (466.917547, 674.509248),
            (466.667547, 672.259248), (471.167547, 672.259248),
            (470.417547, 674.259248), (470.417547, 685.009248),
            (471.417547, 687.009248), (466.917547, 686.509248),
            (465.667547, 684.259248), (456.167547, 685.009248),
            (456.667547, 694.259248)
        }, 452.792547, 680.384248);
        var localNeighbor = Room("local-neighbor", new[]
        {
            (452.167547, 692.009248), (433.917547, 692.009248),
            (433.917547, 699.009248), (433.167547, 691.509248),
            (434.167547, 691.509248), (440.667547, 691.759248),
            (444.417547, 690.509248), (444.417547, 674.759248),
            (446.167547, 677.509248), (445.667547, 686.009248),
            (451.667547, 686.259248)
        }, 449.292547, 688.884248);
        var distantFramePolluter = Rect("polluter", 0, 0, 50, 50, 0.5, 25, 25);

        var result = FrameLocalProjector.Project(Takeoff(room, localNeighbor, distantFramePolluter));
        var accepted = result.Accepted.Rooms.Single(candidate => candidate.Id == "room");

        Assert.Multiple(() =>
        {
            Assert.That(result.Accepted.Rooms.Select(candidate => candidate.Id),
                Is.EquivalentTo(new[] { "room", "polluter" }));
            // Which drift gate fires first is incidental — the invariant is that the neighbor is
            // rejected for drift while the retried room is rescued without relaxing either gate.
            Assert.That(result.Rejected.Single(candidate => candidate.Room.Id == "local-neighbor").Reason,
                Is.EqualTo(FrameLocalRejectionReason.AreaDrift)
                    .Or.EqualTo(FrameLocalRejectionReason.BoundaryDrift)
                    .Or.EqualTo(FrameLocalRejectionReason.SourceFeatureDrop));
            Assert.That(DiscreteHausdorffDistance.Distance(
                ToPolygon(room).Boundary, ToPolygon(accepted).Boundary), Is.LessThanOrEqualTo(1.5 + 1e-7));
            Assert.That(Editability(result.Accepted.Rooms.ToArray()).IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Result_conserves_source_identity_area_and_chained_provenance()
    {
        var acceptedSource = Rect("accepted", 0, 0, 10, 10, 0, 5, 5);
        acceptedSource.RawSqft = 80;
        acceptedSource.SplitFrom = "accepted-source";
        acceptedSource.MergedFrom = "older-parent+tiny";
        acceptedSource.Flags.Add("accepted-flag");
        var rejectedSource = Room("rejected", new[] {
            (8d, 0d), (13d, 5d), (8d, 10d)
        }, 9, 5);
        rejectedSource.RawSqft = 12;
        rejectedSource.SplitFrom = "tiny-source";
        rejectedSource.MergedFrom = "older-tiny+leaf";
        rejectedSource.Flags.AddRange(new[] { "tiny-flag", "review" });

        var result = FrameLocalProjector.Project(Takeoff(acceptedSource, rejectedSource));

        Assert.Multiple(() =>
        {
            Assert.That(result.Conservation.SourceRooms, Is.EqualTo(2));
            Assert.That(result.Conservation.AcceptedRooms + result.Conservation.RejectedRooms,
                Is.EqualTo(2));
            Assert.That(result.Conservation.SourceSqft, Is.EqualTo(92).Within(1e-7));
            Assert.That(result.Conservation.SourceDeltaSqft, Is.EqualTo(0).Within(1e-7));
            Assert.That(result.Conservation.AcceptedRejectedOverlapSqft, Is.GreaterThan(0));
            Assert.That(result.Accepted.Rooms.Single().MergedFrom, Is.EqualTo("older-parent+tiny"));
            Assert.That(result.Rejected.Single().Room.MergedFrom, Is.EqualTo("older-tiny+leaf"));
        });
    }

    private static TakeoffResult Takeoff(params RoomResult[] rooms) => new()
    {
        LevelName = "test",
        LevelElevation = 100,
        Source = TakeoffSource.Native,
        Rooms = rooms.ToList(),
        TotalSqft = rooms.Sum(x => x.RawSqft),
        ProfileProvenance = "fixture",
        LevelFlags = new List<string> { "level-flag" },
        SeedViewA = "a",
        SeedViewB = "b",
        EvidenceView = "evidence"
    };

    private static RoomResult Rect(
        string id, double minX, double minY, double maxX, double maxY,
        double degrees, double labelX, double labelY)
    {
        var points = new[] { (minX, minY), (maxX, minY), (maxX, maxY), (minX, maxY) };
        var rotated = points.Select(p => RotatePoint(0, 0, degrees, p.Item1, p.Item2)).ToArray();
        var rotatedLabel = RotatePoint(0, 0, degrees, labelX, labelY);
        return Room(id, rotated, rotatedLabel.x, rotatedLabel.y);
    }

    private static RoomResult Room(string id, IEnumerable<(double x, double y)> points, double labelX, double labelY)
    {
        var room = new RoomResult
        {
            Id = id,
            LabelX = labelX,
            LabelY = labelY,
            MeanCeilingFt = 9,
            Polygon = points.Select(x => new[] { x.x, x.y }).ToList()
        };
        var polygon = ToPolygon(room);
        room.RawSqft = polygon.Area;
        room.PerimeterFt = polygon.Length;
        return room;
    }

    private static (double x, double y) RotatePoint(
        double centerX, double centerY, double degrees, double x, double y)
    {
        double angle = degrees * Math.PI / 180;
        double dx = x - centerX, dy = y - centerY;
        return (centerX + dx * Math.Cos(angle) - dy * Math.Sin(angle),
            centerY + dx * Math.Sin(angle) + dy * Math.Cos(angle));
    }

    private static Polygon ToPolygon(RoomResult room)
    {
        return Factory.CreatePolygon(Ring(room.Polygon), room.Holes.Select(Ring).ToArray());
    }

    private static LinearRing Ring(List<double[]> points)
    {
        var coordinates = points.Select(x => new Coordinate(x[0], x[1])).ToList();
        if (!coordinates[0].Equals2D(coordinates[^1])) coordinates.Add(coordinates[0].Copy());
        return Factory.CreateLinearRing(coordinates.ToArray());
    }

    private static double SignedArea(List<double[]> points) => Enumerable.Range(0, points.Count)
        .Sum(index =>
        {
            var a = points[index];
            var b = points[(index + 1) % points.Count];
            return a[0] * b[1] - b[0] * a[1];
        }) / 2;

    private static bool IsOrthogonal(RoomResult room)
    {
        var points = room.Polygon;
        if (points.Count < 4) return false;
        var edges = Enumerable.Range(0, points.Count)
            .Select(i => (a: points[i], b: points[(i + 1) % points.Count]))
            .ToList();
        for (int i = 0; i < edges.Count; i++)
        {
            var one = edges[i];
            var two = edges[(i + 1) % edges.Count];
            double ax = one.b[0] - one.a[0], ay = one.b[1] - one.a[1];
            double bx = two.b[0] - two.a[0], by = two.b[1] - two.a[1];
            double dot = ax * bx + ay * by;
            double cross = ax * by - ay * bx;
            if (Math.Abs(dot) > 1e-6 && Math.Abs(cross) > 1e-6) return false;
        }
        return true;
    }

    private static LevelEditabilityAudit Editability(params RoomResult[] rooms) =>
        TakeoffEditability.Evaluate(new LevelTakeoff("test", 0,
            rooms.Select(room => new TakeoffRoomShape(
                room.Id, room.RawSqft, room.PerimeterFt, room.MeanCeilingFt,
                room.Polygon, room.Holes) { Label = [room.LabelX, room.LabelY] }).ToList()));
}
