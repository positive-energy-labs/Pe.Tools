using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class TakeoffPromotionTests
{
    [Test]
    public void Zone_promotion_returns_strict_disposition_and_non_gating_diagnostics()
    {
        var accepted = Room("good", (0, 0), (10, 0), (10, 8), (0, 8));
        var rejected = Room("bad", (20, 0), (25, 5), (20, 10));
        accepted.RawSqft = 80;
        rejected.RawSqft = 50;
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { accepted, rejected },
            DomainSqft = 130,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (30, 0), (30, 10), (0, 10)),
            Options(minimumRoomSqft: 0), (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "good" }));
            Assert.That(promotion.Result.Residues.Single(residue =>
                residue.Reason == ResidueReason.Rejected).Id, Is.EqualTo("bad"));
            Assert.That(promotion.Diagnostics.SourceRooms, Is.EqualTo(2));
            Assert.That(promotion.Diagnostics.SharedNetworkStrictRooms, Is.GreaterThanOrEqualTo(1));
            Assert.That(promotion.Diagnostics.AcceptedRooms, Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.HeldRooms, Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.Rejections.Single().Key, Does.StartWith("frame:"));
            Assert.That(promotion.Diagnostics.Rejections.Single().Value, Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.RejectionDetails["bad"],
                Does.StartWith("frame:"));
            Assert.That(promotion.Diagnostics.InkBackedEdgeFraction, Is.EqualTo(1).Within(1e-9));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
            Assert.That(source.Rooms, Has.Count.EqualTo(2), "promotion must not mutate raw partition evidence");
            Assert.That(source.Residues, Is.Empty);
        });
    }

    [Test]
    public void Zone_promotion_is_deterministic()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("good", (0, 0), (10, 0), (10, 8), (0, 8)) },
            DomainSqft = 80,
        };

        var zone = Zone("room", (0, 0), (10, 0), (10, 8), (0, 8));
        var first = TakeoffPromotion.PromoteZone(source, zone, Options(0), (_, _) => 0);
        var second = TakeoffPromotion.PromoteZone(source, zone, Options(0), (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(second.Result.ToTsv(), Is.EqualTo(first.Result.ToTsv()));
            Assert.That(second.Diagnostics with {
                    Rejections = first.Diagnostics.Rejections,
                    RejectionDetails = first.Diagnostics.RejectionDetails,
                },
                Is.EqualTo(first.Diagnostics));
            Assert.That(second.Diagnostics.Rejections, Is.EqualTo(first.Diagnostics.Rejections));
            Assert.That(second.Diagnostics.RejectionDetails,
                Is.EqualTo(first.Diagnostics.RejectionDetails));
        });
    }

    [Test]
    public void Zone_promotion_represents_uncaptured_scope_as_explicit_excluded_residue()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (0, 0), (10, 0), (10, 10), (0, 10)) },
            DomainSqft = 100,
        };
        var zone = Zone("double", (0, 0), (20, 0), (20, 10), (0, 10));

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, Options(minimumRoomSqft: 0), (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.ZoneSqft, Is.EqualTo(200).Within(1e-9));
            Assert.That(promotion.Diagnostics.AcceptedSqft, Is.EqualTo(100).Within(1e-9));
            Assert.That(promotion.Diagnostics.ExcludedSqft, Is.EqualTo(100).Within(1e-9));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsContained, Is.True);
            Assert.That(promotion.Result.Residues.Single().Reason,
                Is.EqualTo(ResidueReason.Excluded));
        });
    }

    [Test]
    public void Orthogonal_projection_that_leaves_zone_holds_the_room_whole()
    {
        var trapezoid = Room("room", (0, 0), (9, 0), (10, 10), (0, 10));
        trapezoid.RawSqft = 95;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { trapezoid }, DomainSqft = 95,
        };
        var zone = Zone("trapezoid", (0, 0), (9, 0), (10, 10), (0, 10));

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Result.Residues.Count(residue =>
                residue.Reason == ResidueReason.Rejected), Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.HeldSqft, Is.EqualTo(95).Within(1e-6));
            Assert.That(promotion.Diagnostics.ExcludedSqft, Is.Zero.Within(1e-6));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsContained, Is.True);
        });
    }

    [Test]
    public void Held_room_count_tracks_source_rooms_not_clipped_residue_pieces()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("bridge", (0, 0), (30, 0), (30, 10), (0, 10)) },
            DomainSqft = 300,
        };
        var zone = new ZoneScope {
            Name = "two islands",
            Loops = {
                new List<double[]> { new[] { 0d, 0d }, new[] { 10d, 0d },
                    new[] { 10d, 10d }, new[] { 0d, 10d } },
                new List<double[]> { new[] { 20d, 0d }, new[] { 30d, 0d },
                    new[] { 30d, 10d }, new[] { 20d, 10d } },
            },
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Residues.Count(residue =>
                residue.Reason == ResidueReason.Rejected), Is.EqualTo(2));
            Assert.That(promotion.Diagnostics.HeldRooms, Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Adjacent_promoted_rooms_keep_one_exact_shared_orthogonal_edge()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = {
                Room("left", (0, 0), (5, 0), (5.2, 10), (0, 10)),
                Room("right", (5, 0), (10, 0), (10, 10), (5.2, 10)),
            },
            DomainSqft = 100,
        };
        source.Rooms[0].RawSqft = 51;
        source.Rooms[1].RawSqft = 49;
        var zone = Zone("shared", (-1, -1), (11, -1), (11, 11), (-1, 11));

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            string reasons = string.Join(", ", promotion.Diagnostics.Rejections
                .Select(item => $"{item.Key}={item.Value}"));
            Assert.That(promotion.Result.Rooms, Has.Count.EqualTo(2), reasons);
            Assert.That(promotion.Diagnostics.SharedEdgePairs, Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.LostSharedEdgePairs, Is.Zero);
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Frame_local_rejections_become_explicit_residue()
    {
        var accepted = Room("good", (0, 0), (10, 0), (10, 8), (0, 8));
        var rejected = Room("bad", (20, 0), (25, 5), (20, 10));
        var result = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { accepted, rejected },
        };
        var projection = new FrameLocalProjectionResult(
            new TakeoffResult { LevelName = "Level 1", Rooms = { accepted } },
            new[] {
                new FrameLocalRejectedRoom(
                    rejected, FrameLocalRejectionReason.NoCoherentFrame, "fixture")
            },
            new FrameLocalConservation(2, 1, 1, 130, 80, 80, 50, 0));

        var count = TakeoffPromotion.ApplyFrameLocal(result, projection);

        Assert.Multiple(() =>
        {
            Assert.That(count, Is.EqualTo(1));
            Assert.That(result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "good" }));
            Assert.That(result.Residues.Single().Id, Is.EqualTo("bad"));
            Assert.That(result.Residues.Single().Reason, Is.EqualTo(ResidueReason.Rejected));
        });
    }

    [Test]
    public void Tiny_room_with_one_neighbor_merges_when_union_remains_strict()
    {
        var result = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = {
                Room("parent", (0, 0), (10, 0), (10, 10), (0, 10)),
                Room("tiny", (10, 2), (12, 2), (12, 8), (10, 8)),
            },
        };
        result.Rooms[0].RawSqft = 100;
        result.Rooms[1].RawSqft = 12;

        var held = TakeoffPromotion.MergeOrHoldTinyRooms(result, 30);

        Assert.Multiple(() =>
        {
            Assert.That(held, Is.Zero);
            Assert.That(result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "parent" }));
            Assert.That(result.Rooms.Single().RawSqft, Is.EqualTo(112).Within(1e-6));
            Assert.That(result.Rooms.Single().MergedFrom, Is.EqualTo("tiny"));
            Assert.That(result.Residues, Is.Empty);
        });
    }

    [Test]
    public void Tiny_bridge_between_two_neighbors_is_held_for_review()
    {
        var result = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = {
                Room("left", (0, 0), (8, 0), (8, 10), (0, 10)),
                Room("tiny", (8, 3), (10, 3), (10, 7), (8, 7)),
                Room("right", (10, 0), (18, 0), (18, 10), (10, 10)),
            },
        };
        result.Rooms[0].RawSqft = 80;
        result.Rooms[1].RawSqft = 8;
        result.Rooms[2].RawSqft = 80;

        var held = TakeoffPromotion.MergeOrHoldTinyRooms(result, 30);

        Assert.Multiple(() =>
        {
            Assert.That(held, Is.EqualTo(1));
            Assert.That(result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "left", "right" }));
            Assert.That(result.Residues.Single().Id, Is.EqualTo("tiny"));
            Assert.That(result.Residues.Single().Reason, Is.EqualTo(ResidueReason.Rejected));
        });
    }

    [Test]
    public void Promotion_provenance_round_trips_through_canonical_tsv()
    {
        var result = new TakeoffResult {
            LevelName = "Level 1",
            LevelElevation = 10,
            Rooms = { Room("survivor", (0, 0), (10, 0), (10, 10), (0, 10)) },
        };
        result.Rooms.Single().SplitFrom = "source-a";
        result.Rooms.Single().MergedFrom = "source-b+source-c";

        var parsed = TakeoffTsv.ParseTsv(result.ToTsv()).Rooms.Single();

        Assert.Multiple(() => {
            Assert.That(parsed.SplitFrom, Is.EqualTo("source-a"));
            Assert.That(parsed.MergedFrom, Is.EqualTo("source-b+source-c"));
        });
    }

    [Test]
    public void Tiny_merge_preserves_chained_provenance_and_flags()
    {
        var parent = Room("parent", (0, 0), (10, 0), (10, 10), (0, 10));
        parent.RawSqft = 100;
        parent.MergedFrom = "older-parent";
        parent.Flags.Add("parent-flag");
        var tiny = Room("tiny", (10, 2), (12, 2), (12, 8), (10, 8));
        tiny.RawSqft = 12;
        tiny.SplitFrom = "tiny-source";
        tiny.MergedFrom = "older-tiny";
        tiny.Flags.Add("tiny-flag");
        var result = new TakeoffResult { LevelName = "Level 1", Rooms = { parent, tiny } };

        TakeoffPromotion.MergeOrHoldTinyRooms(result, 30);

        Assert.Multiple(() => {
            Assert.That(result.Rooms.Single().MergedFrom,
                Is.EqualTo("older-parent+tiny+tiny-source+older-tiny"));
            Assert.That(result.Rooms.Single().Flags,
                Is.EqualTo(new[] { "parent-flag", "tiny-flag" }));
        });
    }

    private static RoomResult Room(string id, params (double X, double Y)[] points) => new()
    {
        Id = id,
        RawSqft = 80,
        PerimeterFt = 36,
        MeanCeilingFt = 10,
        LabelX = points.Average(point => point.X),
        LabelY = points.Average(point => point.Y),
        Polygon = points.Select(point => new[] { point.X, point.Y }).ToList(),
    };

    private static ZoneScope Zone(string name, params (double X, double Y)[] points) => new() {
        Name = name,
        Loops = { points.Select(point => new[] { point.X, point.Y }).ToList() },
    };

    private static TakeoffOptions Options(
        double minimumRoomSqft, double boundarySimplifyFt = 2) => new() {
        MinimumPromotedRoomSqft = minimumRoomSqft,
        BoundarySimplifyFt = boundarySimplifyFt,
    };
}
