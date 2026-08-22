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
    public void Disposition_legality_detects_equal_area_gap_and_overlap()
    {
        var accepted = Room("accepted", (0, 0), (6, 0), (6, 10), (0, 10));
        accepted.RawSqft = 60;
        var result = new TakeoffResult {
            Rooms = { accepted },
            Residues = { Residue("held", ResidueReason.Rejected,
                (5, 0), (9, 0), (9, 10), (5, 10)) },
        };
        var zone = Zone("zone", (0, 0), (10, 0), (10, 10), (0, 10));

        var legality = TakeoffPromotion.MeasureDispositionLegality(result, zone.ExactGeometry());

        Assert.Multiple(() => {
            Assert.That(Math.Abs(result.Rooms.Sum(room => room.RawSqft)
                + result.Residues.Sum(residue => residue.RawSqft) - 100), Is.Zero,
                "the scalar closure is deliberately blind");
            Assert.That(legality.GapSqft, Is.EqualTo(10).Within(1e-9));
            Assert.That(legality.OverlapSqft, Is.EqualTo(10).Within(1e-9));
            Assert.That(legality.OutsideZoneSqft, Is.Zero.Within(1e-9));
        });
    }

    [TestCase(ResidueReason.Rejected)]
    [TestCase(ResidueReason.Border)]
    [TestCase(ResidueReason.Excluded)]
    public void Disposition_legality_detects_residue_outside_zone(ResidueReason reason)
    {
        var result = new TakeoffResult {
            Rooms = { Room("accepted", (0, 0), (9, 0), (9, 10), (0, 10)) },
            Residues = { Residue("remainder", reason,
                (9, 0), (11, 0), (11, 10), (9, 10)) },
        };
        var zone = Zone("zone", (0, 0), (10, 0), (10, 10), (0, 10));

        var legality = TakeoffPromotion.MeasureDispositionLegality(result, zone.ExactGeometry());

        Assert.Multiple(() => {
            Assert.That(legality.GapSqft, Is.Zero.Within(1e-9));
            Assert.That(legality.OverlapSqft, Is.Zero.Within(1e-9));
            Assert.That(legality.OutsideZoneSqft, Is.EqualTo(10).Within(1e-9));
        });
    }

    [Test]
    public void Disposition_legality_accepts_clean_partition()
    {
        var result = new TakeoffResult {
            Rooms = { Room("accepted", (0, 0), (6, 0), (6, 10), (0, 10)) },
            Residues = { Residue("held", ResidueReason.Rejected,
                (6, 0), (10, 0), (10, 10), (6, 10)) },
        };
        var zone = Zone("zone", (0, 0), (10, 0), (10, 10), (0, 10));

        var legality = TakeoffPromotion.MeasureDispositionLegality(result, zone.ExactGeometry());

        Assert.Multiple(() => {
            Assert.That(legality.GapSqft, Is.Zero.Within(1e-9));
            Assert.That(legality.OverlapSqft, Is.Zero.Within(1e-9));
            Assert.That(legality.OutsideZoneSqft, Is.Zero.Within(1e-9));
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

        // Clip disarmed on purpose. This test owns the held-count law on the path where a room is
        // REJECTED and its geometry then falls apart inside the zone — the path zone-fit fell back
        // to, and the one every zone still takes when fitting fails. Two disjoint islands of equal
        // area are also the one shape where "keep the largest piece" is a coin flip, so they are the
        // wrong fixture to pin clip's behavior on; Zone_fit_keeps_only_the_largest_piece does that
        // with prongs that actually differ.
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.ZoneClipEnabled = false;

        var promotion = TakeoffPromotion.PromoteZone(source, zone, options, (_, _) => 0);

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

    // ---- pre-solve triage ----

    [Test]
    public void Triage_hold_emits_the_whole_zone_as_one_reasoned_residue()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("wander", (0, 0), (10, 0), (10, 10), (0, 10)) },
            DomainSqft = 100,
        };
        var zone = Zone("closet", (0, 0), (20, 0), (20, 10), (0, 10));
        var options = Options(minimumRoomSqft: 0);
        options.SmallZoneSqft = 750;

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, options, (_, _) => 0, TestContext.Out.WriteLine,
            new ZoneCensus(200, 10, 0.05, [], 0));

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Triage!.IsHold, Is.True);
            Assert.That(promotion.Diagnostics.Triage!.Reason, Is.EqualTo("small-zone"));
            Assert.That(promotion.Result.Rooms, Is.Empty, "a held zone never emits a room");
            Assert.That(promotion.Result.Residues.Single().Id, Is.EqualTo("TRIAGE-HELD:small-zone"));
            Assert.That(promotion.Result.Residues.Single().Reason,
                Is.EqualTo(ResidueReason.Rejected));
            Assert.That(promotion.Diagnostics.HeldSqft, Is.EqualTo(200).Within(1e-9),
                "the abstention accounts for the entire declared zone");
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsContained, Is.True);
        });
    }

    [Test]
    public void Triage_census_without_an_armed_knob_changes_nothing()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (0, 0), (10, 0), (10, 10), (0, 10)) },
            DomainSqft = 100,
        };
        var zone = Zone("room", (0, 0), (10, 0), (10, 10), (0, 10));

        var options = Options(minimumRoomSqft: 0);
        options.SmallZoneSqft = 0; // disarm: this test proves an unarmed census is inert
        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, options, (_, _) => 0, null,
            new ZoneCensus(100, 10, 0.1, [], 0));

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Triage!.IsHold, Is.False);
            Assert.That(promotion.Result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "room" }));
        });
    }

    // ---- post-solve recombination ----

    // A parent wrapping a 2x2 notch on three sides: the notch hands 6 of its 8 ft of perimeter to
    // exactly one neighbor, which is the whole point of the absorb rule.
    private static TakeoffResult NotchedPair()
    {
        var parent = Room("parent",
            (0, 0), (10, 0), (10, 12), (6, 12), (6, 10), (4, 10), (4, 12), (0, 12));
        parent.RawSqft = 116;
        var notch = Room("notch", (4, 10), (6, 10), (6, 12), (4, 12));
        notch.RawSqft = 4;
        return new TakeoffResult {
            LevelName = "Level 1", Rooms = { parent, notch }, DomainSqft = 120,
        };
    }

    [Test]
    public void Absorb_neighbor_merges_a_room_that_hands_most_of_its_perimeter_to_one_neighbor()
    {
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.AbsorbNeighborMaxSqft = 10;

        var promotion = TakeoffPromotion.PromoteZone(
            NotchedPair(), Zone("all", (0, 0), (10, 0), (10, 12), (0, 12)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "parent" }));
            Assert.That(promotion.Result.Rooms.Single().RawSqft, Is.EqualTo(120).Within(1e-6));
            Assert.That(promotion.Result.Rooms.Single().MergedFrom, Is.EqualTo("notch"));
            Assert.That(promotion.Diagnostics.Rejections["absorb:merged"], Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Absorb_neighbor_is_inert_when_disarmed()
    {
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.AbsorbNeighborMaxSqft = 0;
        options.EdgeBandFt = 0;
        var promotion = TakeoffPromotion.PromoteZone(
            NotchedPair(), Zone("all", (0, 0), (10, 0), (10, 12), (0, 12)),
            options, (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms, Has.Count.EqualTo(2));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("absorb:merged"));
        });
    }

    [Test]
    public void Edge_band_room_merges_into_its_largest_interior_neighbor()
    {
        var rind = Room("rind", (0, 0), (20, 0), (20, 2), (0, 2));
        rind.RawSqft = 40;
        var interior = Room("interior", (0, 2), (20, 2), (20, 20), (0, 20));
        interior.RawSqft = 360;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { rind, interior }, DomainSqft = 400,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.EdgeBandFt = 2.0;
        options.AbsorbNeighborMaxSqft = 0; // disarm absorb so the merge is attributable to edge-band

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Select(room => room.Id),
                Is.EqualTo(new[] { "interior" }));
            Assert.That(promotion.Result.Rooms.Single().RawSqft, Is.EqualTo(400).Within(1e-6));
            Assert.That(promotion.Diagnostics.Rejections["edgeband:merged"], Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Edge_band_room_with_no_neighbor_is_left_for_the_downstream_gates()
    {
        var rind = Room("rind", (0, 0), (20, 0), (20, 2), (0, 2));
        rind.RawSqft = 40;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { rind }, DomainSqft = 40,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.EdgeBandFt = 2.0;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "rind" }),
                "recombination has nothing to fold into, so it declines to decide");
            Assert.That(promotion.Diagnostics.Rejections.Keys,
                Has.No.Member("edgeband:merged").And.No.Member("edgeband:held"));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Absorb_picks_the_neighbor_holding_the_most_shared_perimeter()
    {
        // A 2x2 pocket notched into "big" on three sides (6 ft shared) and merely abutting "small"
        // along its open top edge (2 ft). Two neighbors — the old "exactly one" rule skipped this
        // shape entirely, which is why the stage never fired on real zones.
        var big = Room("big",
            (0, 0), (10, 0), (10, 12), (6, 12), (6, 10), (4, 10), (4, 12), (0, 12));
        big.RawSqft = 116;
        var pocket = Room("pocket", (4, 10), (6, 10), (6, 12), (4, 12));
        pocket.RawSqft = 4;
        // Vertices at x=4 and x=6 so the three rooms form a valid shared-edge coverage: "small"
        // meets "big" twice and the pocket once along y=12.
        var small = Room("small",
            (0, 12), (4, 12), (6, 12), (10, 12), (10, 16), (0, 16));
        small.RawSqft = 40;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { big, pocket, small }, DomainSqft = 160,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.AbsorbNeighborMaxSqft = 10;
        options.EdgeBandFt = 0; // disarm edge-band: "small" sits half inside the default 2 ft band

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (10, 0), (10, 16), (0, 16)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Rejections["absorb:merged"], Is.EqualTo(1));
            Assert.That(promotion.Result.Rooms.Select(room => room.Id),
                Is.EquivalentTo(new[] { "big", "small" }));
            Assert.That(promotion.Result.Rooms.Single(room => room.Id == "big").RawSqft,
                Is.EqualTo(120).Within(1e-6), "the pocket went to the 6 ft neighbor, not the 2 ft one");
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Recombination_runs_before_the_frame_projector_can_reject_the_lattice_cell()
    {
        // The pocket alone is a legal orthogonal rectangle, so this proves ordering rather than
        // shape: absorbed geometry must reach the projector already merged.
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.AbsorbNeighborMaxSqft = 10;

        var promotion = TakeoffPromotion.PromoteZone(
            NotchedPair(), Zone("all", (0, 0), (10, 0), (10, 12), (0, 12)),
            options, (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("frame:NoCoherentFrame"));
            Assert.That(promotion.Result.Rooms, Has.Count.EqualTo(1));
            Assert.That(promotion.Diagnostics.SourceRooms, Is.EqualTo(2));
        });
    }

    [Test]
    public void Zone_fit_snaps_a_room_edge_lying_just_inside_the_zone_boundary_onto_it()
    {
        // The right edge sits 0.4 ft inside the zone's parallel right edge — a void sliver that no
        // gate is wrong about and every gate leaves behind. The zone edge is authority, so the room
        // moves onto it rather than the sliver being explained. The ink model says the sliver is
        // EMPTY (backed boundary everywhere, no wall between edge and zone line) — the historical
        // `(_, _) => 0` stub put ink inside the sweep and now means the opposite thing (see the
        // sibling test below).
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (2, 2), (19.6, 2), (19.6, 18), (2, 18)) },
            DomainSqft = 281.6,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)),
            Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (x, _) => x > 19.7 ? 5 : 0,
            TestContext.Out.WriteLine);

        var room = promotion.Result.Rooms.Single();
        Assert.Multiple(() => {
            Assert.That(room.RawSqft, Is.EqualTo(288).Within(1e-6),
                "the 0.4 ft sliver along the zone edge is now inside the room");
            Assert.That(room.Polygon.Max(point => point[0]), Is.EqualTo(20).Within(1e-9));
            Assert.That(room.Flags, Contains.Item("zone-fit"));
            Assert.That(promotion.Diagnostics.Rejections["zonefit:snapped"], Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("zonefit:fallback"));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Zone_fit_snap_refuses_to_sweep_the_edge_across_ink_hugging_the_zone_line()
    {
        // Same room, same zone — but now the 0.4 ft between the room's edge and the declared line
        // is wall ink (distance 0 everywhere): the designer drew the zone through the wall, and the
        // room already ends at the wall's face. Snapping onto the line would swallow the clipped
        // half-wall, so the snap refuses and the room stands accepted exactly where the ink says
        // it ends. The zone stays authority — the room simply never reached it.
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (2, 2), (19.6, 2), (19.6, 18), (2, 18)) },
            DomainSqft = 281.6,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)),
            Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        var room = promotion.Result.Rooms.Single();
        Assert.Multiple(() => {
            Assert.That(room.RawSqft, Is.EqualTo(281.6).Within(1e-6),
                "the clipped half-wall stays out of the room");
            Assert.That(room.Polygon.Max(point => point[0]), Is.EqualTo(19.6).Within(1e-9));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("zonefit:snapped"));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
        });
    }

    [Test]
    public void Zone_fit_clips_an_overhanging_room_instead_of_the_scope_gate_rejecting_it()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (5, 5), (25, 5), (25, 15), (5, 15)) },
            DomainSqft = 200,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)),
            Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Single().RawSqft, Is.EqualTo(150).Within(1e-6),
                "the overhang is trimmed, not grounds for throwing the room away");
            Assert.That(promotion.Result.Rooms.Single().Flags, Contains.Item("zone-fit"));
            Assert.That(promotion.Diagnostics.Rejections["zonefit:clipped"], Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("scope:outside"));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsContained, Is.True);
        });
    }

    [Test]
    public void Zone_fit_clips_coverage_partners_in_one_motion_when_the_new_edge_is_backed()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = {
                Room("lower", (0, 0), (12, 0), (12, 5), (0, 5)),
                Room("upper", (0, 5), (12, 5), (12, 10), (0, 10)),
            },
            DomainSqft = 120,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.EdgeBandFt = 0;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (10, 0), (10, 10), (0, 10)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms, Has.Count.EqualTo(2));
            Assert.That(promotion.Result.Rooms.Select(room => room.RawSqft),
                Is.All.EqualTo(50).Within(1e-6));
            Assert.That(promotion.Diagnostics.Rejections["zonefit:joint-clipped"], Is.EqualTo(2));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("scope:outside"));
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Worst_unbacked_run_is_counted_per_segment_in_quarter_foot_samples()
    {
        var room = Room("room", (0, 0), (4.3, 0), (4.3, 2), (0, 2));
        double worst = TakeoffEvidenceFidelity.WorstUnbackedRunFt(
            room, (x, y) => y < 1e-6 && x > 1e-6 ? 1 : 0, null, 0);

        Assert.That(worst, Is.EqualTo(4.25).Within(1e-9));
    }

    [Test]
    public void Zone_fit_falls_back_when_the_zone_edge_runs_diagonal_to_the_room_frame()
    {
        // The zone's top edge slopes relative to the room's frame. Edge-wise snapping refuses the
        // move up front — only a near-parallel zone segment may pull a room edge — so the pre-fit
        // room stands untouched and no zone-fit event fires at all. (Vertex-wise snapping used to
        // try the tilt and count a fallback; that path was falsified on the diagonal wings.)
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (2, 2), (18, 2), (18, 9.8), (2, 9.8)) },
            DomainSqft = 124.8,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("sloped", (0, 0), (20, 0), (20, 10), (0, 14)),
            Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        var room = promotion.Result.Rooms.Single();
        Assert.Multiple(() => {
            Assert.That(room.RawSqft, Is.EqualTo(124.8).Within(1e-6), "pre-fit geometry, untouched");
            Assert.That(room.Polygon.Max(point => point[1]), Is.EqualTo(9.8).Within(1e-9));
            Assert.That(room.Flags, Has.No.Member("zone-fit"));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("zonefit:fallback"));
            Assert.That(promotion.Diagnostics.Rejections.Keys, Has.No.Member("zonefit:snapped"));
            Assert.That(promotion.Diagnostics.IsStrictlyEditable, Is.True);
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Zone_fit_keeps_only_the_largest_piece_when_clipping_shatters_a_room()
    {
        // A bar crossing the mouth of a U-shaped zone survives only inside the two prongs. Keeping
        // both would be the solver inventing a partition split the detector never proposed, so the
        // larger prong is the room and the smaller is residue.
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("bar", (0, 12), (20, 12), (20, 16), (0, 16)) },
            DomainSqft = 80,
        };

        var promotion = TakeoffPromotion.PromoteZone(
            source,
            Zone("u", (0, 0), (20, 0), (20, 20), (16, 20), (16, 8), (6, 8), (6, 20), (0, 20)),
            Options(minimumRoomSqft: 0, boundarySimplifyFt: 0), (_, _) => 0,
            TestContext.Out.WriteLine);

        var residue = promotion.Result.Residues
            .Single(item => item.Id.StartsWith("bar~zonefit", StringComparison.Ordinal));
        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Single().RawSqft, Is.EqualTo(24).Within(1e-6),
                "the 6 ft prong, not the 4 ft one");
            Assert.That(residue.Reason, Is.EqualTo(ResidueReason.Rejected));
            Assert.That(residue.RawSqft, Is.EqualTo(16).Within(1e-6));
            Assert.That(promotion.Diagnostics.Rejections["zonefit:clipped"], Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
            Assert.That(promotion.Diagnostics.IsContained, Is.True);
        });
    }

    [Test]
    public void Zone_fit_is_inert_when_both_knobs_are_off()
    {
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.ZoneSnapFt = 0;
        options.ZoneClipEnabled = false;

        var promotion = TakeoffPromotion.PromoteZone(
            new TakeoffResult {
                LevelName = "Level 1",
                Rooms = { Room("room", (5, 5), (25, 5), (25, 15), (5, 15)) },
                DomainSqft = 200,
            },
            Zone("all", (0, 0), (20, 0), (20, 20), (0, 20)), options, (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Diagnostics.Rejections["scope:outside"], Is.EqualTo(1),
                "with zone-fit disarmed the overhang is a scope rejection, exactly as before");
            Assert.That(promotion.Diagnostics.Rejections.Keys
                .Where(key => key.StartsWith("zonefit:", StringComparison.Ordinal)), Is.Empty);
        });
    }

    [Test]
    public void Zone_policy_carries_no_live_rules_and_attributes_nothing()
    {
        // The sparse-wall absorb rule and its SparseWall* knobs were deleted 2026-08-16 (falsified
        // at the 2.5 ft drift budget on 2026-08-14; inkRatio falsified as a discriminator on
        // framing-clean bins on 2026-08-16). The seam itself stays per the tombstone: pure,
        // attributed, and — until a rule earns its way in — an identity even when armed.
        var baseline = Options(minimumRoomSqft: 30);
        baseline.AdaptivePolicy = true;
        var sparse = new ZoneCensus(4000, 120, 0.03, [], 0.2);
        var lattice = new ZonePartitionStats(8, 90, 2.0);

        var armed = ZonePolicy.Adapt(sparse, lattice, baseline);
        baseline.AdaptivePolicy = false;
        var disarmed = ZonePolicy.Adapt(sparse, lattice, baseline);

        Assert.Multiple(() => {
            Assert.That(armed.AdaptedKnobs, Is.Empty, "no live rules: armed adapts nothing");
            Assert.That(armed.Options.AbsorbNeighborSharedPerimeterFraction,
                Is.EqualTo(0.45).Within(1e-9));
            Assert.That(disarmed.AdaptedKnobs, Is.Empty);
            Assert.That(disarmed.Options.AbsorbNeighborSharedPerimeterFraction,
                Is.EqualTo(0.45).Within(1e-9));
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

    private static ResidueResult Residue(
        string id, ResidueReason reason, params (double X, double Y)[] points) => new()
    {
        Id = id,
        Reason = reason,
        RawSqft = Math.Abs(points.Select((point, index) =>
            point.X * points[(index + 1) % points.Length].Y
            - points[(index + 1) % points.Length].X * point.Y).Sum()) / 2,
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
