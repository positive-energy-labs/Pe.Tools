using NUnit.Framework;
using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

public sealed class TakeoffPromotionTests
{
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
}
