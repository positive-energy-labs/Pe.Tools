using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using NetTopologySuite.Operation.Union;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

[TestFixture]
public sealed class NativeProposalTests {
    private static readonly GeometryFactory Factory = new();
    private static readonly Resolved Gate = new([], [], [], [], []);
    private static readonly SliceAnswer Empty = new(
        new Stamp("unit-domain", 0, Stamp.HostInternalFt, DateTime.UnixEpoch, [], true, Gate),
        new Searched(0, 0, 0, 0, 0), [], 0, 0);

    [Test]
    public void Courtyard_proposal_preserves_identity_and_holds_every_missing_component() {
        var proposal = new RoomProposal("doc|link-instance|room-7", "Courtyard room", "7",
            [Box(2, 2, 18, 18), Box(8, 8, 12, 12)]);
        var answer = Run([Box(0, 0, 20, 20), Box(30, 0, 40, 10)], [proposal]);
        var native = answer.Rooms.Single(r => r.Proposal is not null);
        var held = answer.Rooms.Where(r => r.Proposal is null).ToArray();
        var expectedNative = new WKTReader().Read(
            "POLYGON ((2 2,18 2,18 18,2 18,2 2),(8 8,12 8,12 12,8 12,8 8))");
        var expectedHeld = new WKTReader().Read(
            "MULTIPOLYGON (((0 0,20 0,20 20,0 20,0 0),(2 2,18 2,18 18,2 18,2 2))," +
            "((8 8,12 8,12 12,8 12,8 8)),((30 0,40 0,40 10,30 10,30 0)))");

        Assert.Multiple(() => {
            Assert.That(native.Proposal, Is.SameAs(proposal));
            Assert.That(native.Proposal!.SourceKey, Is.EqualTo("doc|link-instance|room-7"));
            Assert.That(native.Disposition, Is.EqualTo(Disposition.Accepted));
            Assert.That(native.Holes, Has.Count.EqualTo(1));
            Assert.That(Polygon(native).SymmetricDifference(expectedNative).Area, Is.Zero);
            Assert.That(held, Has.Length.EqualTo(3));
            Assert.That(held.All(r => r.Disposition == Disposition.Held && r.Reason == "unit: empty enclosure"), Is.True);
            Assert.That(UnaryUnionOp.Union(held.Select(r => (Geometry)Polygon(r)).ToList())
                .SymmetricDifference(expectedHeld).Area, Is.Zero);
            Assert.That(answer.Accounting, Is.EqualTo(new Accounting(500, 240, 260, 0, 0)));
        });
        AssertPartition(answer, expectedNative.Union(expectedHeld));
    }

    [Test]
    public void Overlapping_native_proposals_hold_the_contested_area_without_assigning_first_winner() {
        var a = new RoomProposal("room-a", "A", "1", [Box(2, 2, 12, 12)]);
        var b = new RoomProposal("room-b", "B", "2", [Box(8, 8, 18, 18)]);
        foreach (var order in new[] { new[] { a, b }, new[] { b, a } }) {
            var answer = Run([Box(0, 0, 20, 20)], order);
            var conflict = answer.Rooms.Single(r => r.Reason == "native-overlap");
            Assert.That(conflict.Disposition, Is.EqualTo(Disposition.Held));
            Assert.That(conflict.AreaSqft, Is.EqualTo(16));
            Assert.That(conflict.Proposal, Is.Null);
            Assert.That(answer.Rooms.Where(r => r.Proposal is not null).Sum(r => r.AreaSqft), Is.EqualTo(168));
            AssertPartition(answer, new WKTReader().Read("POLYGON ((0 0,20 0,20 20,0 20,0 0))"));
        }
    }

    [Test]
    public void Valid_outside_proposal_does_not_change_inside_coverage() {
        var zone = new[] { Box(0, 0, 20, 20) };
        var baseline = Run(zone, []);
        var outside = new RoomProposal("outside-room", "Outside", "9", [Box(30, 0, 40, 10)]);
        var answer = Run(zone, [outside]);

        Assert.Multiple(() => {
            Assert.That(answer.Rooms, Has.Count.EqualTo(1));
            Assert.That(answer.Rooms[0].Proposal, Is.Null);
            Assert.That(answer.Rooms[0].Disposition, Is.EqualTo(Disposition.Held));
            Assert.That(answer.Rooms[0].Reason, Is.EqualTo(baseline.Rooms[0].Reason));
            Assert.That(answer.Hold, Is.EqualTo(baseline.Hold));
            Assert.That(answer.Accounting, Is.EqualTo(new Accounting(400, 0, 400, 0, 0)));
            Assert.That(Polygon(answer.Rooms[0]).SymmetricDifference(Polygon(baseline.Rooms[0])).Area, Is.Zero);
        });
        AssertPartition(answer, new WKTReader().Read("POLYGON ((0 0,20 0,20 20,0 20,0 0))"));
    }

    [TestCase(null, 9.0, Disposition.Held, Reasons.NoFloor)]
    [TestCase(0.0, null, Disposition.Held, Reasons.NoCeiling)]
    [TestCase(0.0, 5.0, Disposition.Void, Reasons.LowHeadroom)]
    [TestCase(0.0, 9.0, Disposition.Accepted, null)]
    public void Missing_height_evidence_is_reviewable_and_only_measured_low_headroom_is_void(
        double? floor, double? ceiling, Disposition disposition, string? reason) {
        var proposal = new RoomProposal("unit-room", "Unit room", "1", [Box(0, 0, 20, 20)]);
        var room = Run(proposal.Loops, [proposal], floor, ceiling).Rooms.Single();
        Assert.That((room.Disposition, room.Reason), Is.EqualTo((disposition, reason)));
        Assert.That(room.Proposal, Is.SameAs(proposal));
    }

    private static PartitionAnswer Run(double[][] zone, IReadOnlyList<RoomProposal> proposals,
        double? floor = 0, double? ceiling = 9) {
        var queries = new List<(double X, double Y)>();
        // Explicit unit-domain evidence: a floor at 0 and ceiling at 9, never a live-capture claim.
        ProbeAnswer Probe(double x, double y) {
            queries.Add((x, y));
            var handle = new Handle("unit-domain", 1, "unit-hit", null, "unit", PrimKind.Solid);
            return new ProbeAnswer(Empty.Stamp, Empty.Searched,
                floor is { } f ? new ProbeHit(handle, 3.5 - f, f) : null,
                ceiling is { } c ? new ProbeHit(handle, c - 3.5, c) : null, 200, 0,
                ProbePurpose.RoomHeights);
        }
        var answer = Solve.Run(new PartitionInput(Empty, Empty, zone, 0, Knobs.Default,
            [Gate, Gate, Gate, Gate], "unit-domain", proposals, "unit: empty enclosure"), Probe);
        Assert.That(queries, Is.EqualTo(answer.Rooms.Where(r => r.Disposition != Disposition.Excluded)
            .Select(r => (r.LabelX, r.LabelY)).ToArray()), "probe requests must equal final labels exactly");
        return answer;
    }

    private static void AssertPartition(PartitionAnswer answer, Geometry zone) {
        var parts = answer.Rooms.Select(Polygon).ToArray();
        foreach (var part in parts) {
            Assert.That(part.IsValid, Is.True);
            Assert.That(part.Difference(zone).Area, Is.Zero, "outside spill");
        }
        for (var i = 0; i < parts.Length; i++) {
            Assert.That(parts[i].Area, Is.EqualTo(answer.Rooms[i].AreaSqft));
            for (var j = i + 1; j < parts.Length; j++)
                Assert.That(parts[i].Intersection(parts[j]).Area, Is.Zero, $"overlap {i}/{j}");
        }
        Assert.That(UnaryUnionOp.Union(parts.Cast<Geometry>().ToList()).SymmetricDifference(zone).Area,
            Is.Zero, "all emitted dispositions must exactly cover the zone");
        var a = answer.Accounting;
        Assert.That(a.Accepted + a.Held + a.Void + a.Excluded, Is.EqualTo(zone.Area));
    }

    private static Polygon Polygon(Room room) => Factory.CreatePolygon(Ring(room.Loop),
        (room.Holes ?? []).Select(Ring).ToArray());

    private static LinearRing Ring(double[] xy) {
        var points = Enumerable.Range(0, xy.Length / 2).Select(i => new Coordinate(xy[2 * i], xy[2 * i + 1])).ToList();
        if (!points[0].Equals2D(points[^1])) points.Add(points[0].Copy());
        return Factory.CreateLinearRing(points.ToArray());
    }

    private static double[] Box(double x0, double y0, double x1, double y1) => [x0, y0, x1, y0, x1, y1, x0, y1];
}
