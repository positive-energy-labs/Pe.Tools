using NUnit.Framework;
using NetTopologySuite.Geometries;
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
    public void Excluded_hole_owned_only_by_one_held_room_rejoins_that_room()
    {
        var held = Residue("held", ResidueReason.Rejected,
            (0, 0), (10, 0), (10, 10), (0, 10));
        held.Holes.Add(new[] { (3d, 3d), (3d, 7d), (7d, 7d), (7d, 3d) }
            .Select(point => new[] { point.Item1, point.Item2 }).ToList());
        held.RawSqft = 84;
        var result = new TakeoffResult {
            Residues = {
                held,
                Residue("hole", ResidueReason.Excluded,
                    (3, 3), (7, 3), (7, 7), (3, 7)),
                Residue("outside", ResidueReason.Excluded,
                    (10, 0), (12, 0), (12, 10), (10, 10)),
            },
        };
        var zone = Zone("zone", (0, 0), (12, 0), (12, 10), (0, 10)).ExactGeometry();

        int filled = TakeoffPromotion.FillInteriorResidueGaps(result, zone);
        var legality = TakeoffPromotion.MeasureDispositionLegality(result, zone);

        Assert.Multiple(() => {
            Assert.That(filled, Is.EqualTo(1));
            Assert.That(held.RawSqft, Is.EqualTo(100).Within(1e-9));
            Assert.That(held.Holes, Is.Empty);
            Assert.That(result.Residues.Single(residue =>
                residue.Reason == ResidueReason.Excluded).Id, Is.EqualTo("outside"));
            Assert.That(legality.GapSqft, Is.Zero.Within(1e-9));
            Assert.That(legality.OverlapSqft, Is.Zero.Within(1e-9));
        });
    }

    [Test]
    public void Excluded_hole_rejoins_its_non_room_residue_owner()
    {
        var voidOwner = Residue("void", ResidueReason.Crumb,
            (0, 0), (10, 0), (10, 10), (0, 10));
        voidOwner.Holes.Add(new[] { (3d, 3d), (3d, 7d), (7d, 7d), (7d, 3d) }
            .Select(point => new[] { point.Item1, point.Item2 }).ToList());
        voidOwner.RawSqft = 84;
        var result = new TakeoffResult {
            Residues = {
                voidOwner,
                Residue("hole", ResidueReason.Excluded,
                    (3, 3), (7, 3), (7, 7), (3, 7)),
            },
        };
        var zone = Zone("zone", (0, 0), (10, 0), (10, 10), (0, 10)).ExactGeometry();

        int filled = TakeoffPromotion.FillInteriorResidueGaps(result, zone);

        Assert.Multiple(() => {
            Assert.That(filled, Is.EqualTo(1));
            Assert.That(voidOwner.RawSqft, Is.EqualTo(100).Within(1e-9));
            Assert.That(voidOwner.Holes, Is.Empty);
            Assert.That(result.Residues, Has.Count.EqualTo(1));
        });
    }

    [Test]
    public void Internal_excluded_sliver_joins_a_held_owner_but_zone_edge_band_stays_excluded()
    {
        var left = Residue("left", ResidueReason.Rejected,
            (0, 0), (5, 0), (5, 10), (0, 10));
        var right = Residue("right", ResidueReason.Rejected,
            (7, 0), (12, 0), (12, 10), (7, 10));
        var result = new TakeoffResult {
            Residues = {
                left,
                right,
                Residue("internal", ResidueReason.Excluded,
                    (5, 2), (7, 2), (7, 8), (5, 8)),
                Residue("edge", ResidueReason.Excluded,
                    (5, 0), (7, 0), (7, 2), (5, 2)),
            },
        };
        var zone = Zone("zone", (0, 0), (12, 0), (12, 10), (0, 10)).ExactGeometry();

        int filled = TakeoffPromotion.FillInteriorResidueGaps(result, zone);

        Assert.Multiple(() => {
            Assert.That(filled, Is.EqualTo(1));
            Assert.That(left.RawSqft, Is.EqualTo(62).Within(1e-9));
            Assert.That(result.Residues.Single(residue =>
                residue.Reason == ResidueReason.Excluded).Id, Is.EqualTo("edge"));
        });
    }

    [Test]
    public void Zone_edge_sliver_rejoins_its_exact_detector_room_owner()
    {
        var left = Residue("left", ResidueReason.Rejected,
            (0, 0), (5, 0), (5, 10), (0, 10));
        var right = Residue("right", ResidueReason.Rejected,
            (7, 0), (12, 0), (12, 10), (7, 10));
        var cells = new int[12 * 10];
        for (int y = 0; y < 2; y++)
        for (int x = 5; x < 7; x++) cells[y * 12 + x] = 1;
        var result = new TakeoffResult {
            Residues = {
                left,
                right,
                Residue("edge", ResidueReason.Excluded,
                    (5, 0), (7, 0), (7, 2), (5, 2)),
            },
            Ownership = new DetectorOwnership(
                12, 10, 0, 0, 1, cells, new bool[cells.Length],
                new DetectorUnownedCause[cells.Length],
                new Dictionary<int, DetectorOwnerMetadata> {
                    [1] = new(1, "left", DetectorOwnerDisposition.Room, null),
                }),
        };
        var zone = Zone("zone", (0, 0), (12, 0), (12, 10), (0, 10)).ExactGeometry();

        int filled = TakeoffPromotion.FillInteriorResidueGaps(result, zone);

        Assert.Multiple(() => {
            Assert.That(filled, Is.EqualTo(1));
            Assert.That(left.RawSqft, Is.EqualTo(54).Within(1e-9));
            Assert.That(result.Residues, Has.Count.EqualTo(2));
        });
    }

    [Test]
    public void Zone_snap_keeps_collinear_runs_collinear()
    {
        var factory = new GeometryFactory();
        var room = factory.CreatePolygon([
            new(10, 0), new(0.5, 0), new(0.5, 5),
            new(0.5, 10), new(10, 10), new(10, 0),
        ]);
        var zone = Zone("zone", (0, 0), (10, 0), (10, 10), (0, 10)).ExactGeometry();

        var snapped = TakeoffPromotion.SnapToZone(room, zone.Boundary, [], 1);

        Assert.Multiple(() => {
            Assert.That(snapped, Is.Not.Null);
            Assert.That(snapped!.Coordinates.Where(point => point.X < 1)
                .Select(point => point.X), Is.All.Zero.Within(1e-9));
            Assert.That(snapped.Area, Is.EqualTo(100).Within(1e-9));
        });
    }

    [Test]
    public void Unclaimed_disconnected_zone_component_is_held_whole()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("covered", (20, 0), (30, 0), (30, 10), (20, 10)) },
            DomainSqft = 100,
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
            source, zone, Options(minimumRoomSqft: 30, boundarySimplifyFt: 0), (_, _) => 0);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms.Single().Id, Is.EqualTo("covered"));
            Assert.That(promotion.Result.Residues.Count(residue =>
                residue.Reason == ResidueReason.Rejected), Is.EqualTo(1));
            Assert.That(promotion.Diagnostics.HeldSqft, Is.EqualTo(100).Within(1e-6));
            Assert.That(promotion.Diagnostics.ExcludedSqft, Is.Zero.Within(1e-6));
            Assert.That(promotion.Diagnostics.Rejections["zone-component:held"], Is.EqualTo(1));
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
    public void Frame_local_narrow_neck_keeps_label_owned_room_and_holds_other_lobe()
    {
        RoomResult Candidate() => Room("dumbbell",
            (288.610510, 609.721599), (290.516748, 611.627843),
            (292.757185, 613.868287), (295.173002, 616.284112),
            (296.235494, 617.346607), (293.905873, 619.676221),
            (293.171515, 620.410576), (292.421470, 621.160619),
            (290.562119, 623.019964), (292.410115, 624.867966),
            (290.978085, 626.299991), (289.910105, 627.367968),
            (288.062109, 625.519966), (286.999617, 624.457471),
            (288.067597, 623.389494), (289.499627, 621.957469),
            (287.083810, 619.541644), (284.843373, 617.301200),
            (282.937135, 615.394955), (278.218384, 610.676189),
            (277.312133, 609.769935), (276.874624, 609.332425),
            (276.293619, 608.751418), (278.152970, 606.892073),
            (278.733975, 607.473080), (279.484020, 606.723037),
            (280.218378, 605.988682), (280.655887, 606.426192),
            (281.562138, 607.332445), (283.891759, 605.002832));
        var room = Candidate();
        room.LabelX = 289.405904;
        room.LabelY = 616.301187;
        double sourceArea = TakeoffGeometry.ToPolygon(room).Area;
        var result = new TakeoffResult { LevelName = "Level 1", Rooms = { room } };

        var detached = TakeoffPromotion.DetachNarrowNecks(
            result, 1, 30, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(detached, Is.EqualTo(1));
            Assert.That(result.Rooms.Single().LabelX, Is.EqualTo(289.405904));
            Assert.That(result.Residues.Select(item => item.Id),
                Is.All.StartsWith("dumbbell~neck"));
            Assert.That(result.Residues.Select(item => item.Reason),
                Is.All.EqualTo(ResidueReason.Rejected));
            Assert.That(result.Rooms.Single().RawSqft, Is.EqualTo(151.208).Within(0.01));
            Assert.That(result.Rooms.Single().RawSqft + result.Residues.Sum(item => item.RawSqft),
                Is.EqualTo(sourceArea).Within(1e-5));
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
    public void Small_zone_without_an_accepted_partition_falls_back_to_one_reasoned_residue()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            DomainSqft = 200,
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
    public void Promotion_stage_trace_captures_shared_network_and_frame_projector()
    {
        var accepted = Room("good", (0, 0), (10, 0), (10, 8), (0, 8));
        var rejected = Room("bad", (20, 0), (25, 5), (20, 10));
        accepted.RawSqft = 80;
        rejected.RawSqft = 50;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { accepted, rejected }, DomainSqft = 130,
        };
        var snapshots = new List<(string Stage, TakeoffResult Result)>();

        _ = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (30, 0), (30, 10), (0, 10)),
            Options(minimumRoomSqft: 0), (_, _) => 0,
            stageSnapshot: (stage, result) => snapshots.Add((stage, result)));

        Assert.Multiple(() => {
            Assert.That(snapshots.Select(item => item.Stage),
                Is.EqualTo(new[] { "shared-network", "frame-projector" }));
            Assert.That(snapshots[0].Result.Rooms, Has.Count.EqualTo(2));
            Assert.That(snapshots[1].Result.Rooms, Has.Count.EqualTo(1));
            Assert.That(snapshots[0].Result, Is.Not.SameAs(snapshots[1].Result));
            Assert.That(source.Rooms, Has.Count.EqualTo(2));
        });
    }

    [Test]
    public void Small_zone_uses_a_valid_partition_before_falling_back_to_whole_zone()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("room", (0, 0), (10, 0), (10, 10), (0, 10)) },
            DomainSqft = 100,
        };
        var zone = Zone("room", (0, 0), (10, 0), (10, 10), (0, 10));
        var options = Options(minimumRoomSqft: 0);
        options.SmallZoneSqft = 750;

        var promotion = TakeoffPromotion.PromoteZone(
            source, zone, options, (_, _) => 0, TestContext.Out.WriteLine,
            new ZoneCensus(100, 10, 0.1, [], 0));

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Triage!.IsHold, Is.False);
            Assert.That(promotion.Result.Rooms.Select(room => room.Id), Is.EqualTo(new[] { "room" }));
            Assert.That(promotion.Result.Residues.Select(residue => residue.Id),
                Has.No.Member("TRIAGE-HELD:small-zone"));
        });
    }

    [Test]
    public void Small_zone_holds_a_zone_only_room_recombined_from_three_candidates()
    {
        var room = Room("room", (0, 0), (10, 0), (10, 10), (0, 10));
        room.MergedFrom = "a+b+c";
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { room },
            DomainSqft = 100,
        };
        var options = Options(minimumRoomSqft: 0);
        options.SmallZoneSqft = 750;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("room", (0, 0), (10, 0), (10, 10), (0, 10)),
            options, (_, _) => 0, TestContext.Out.WriteLine,
            new ZoneCensus(100, 10, 0.1, [], 0));

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Triage!.IsHold, Is.True);
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Result.Residues.Single().Id, Is.EqualTo("TRIAGE-HELD:small-zone"));
            Assert.That(promotion.Diagnostics.Rejections["small-zone:ambiguous-merge"], Is.EqualTo(1));
        });
    }

    [Test]
    public void Promotion_holds_a_room_stitched_by_more_heuristic_closures_than_vertices()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("stitched", (1, 1), (11, 1), (11, 11), (1, 11)) },
            DomainSqft = 100,
        };

        byte ClosureAt(double x, double y) =>
            (int)Math.Floor(x + y) % 2 == 0
                ? Detector.SealWallRunGap
                : Detector.SealGapClose;
        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (12, 0), (12, 12), (0, 12)),
            Options(minimumRoomSqft: 0), (_, _) => 0,
            distanceToWallInk: (_, _) => double.PositiveInfinity,
            heuristicClosureAt: ClosureAt);

        Assert.Multiple(() => {
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Diagnostics.Rejections["closure:overstitched"], Is.EqualTo(1));
        });
    }

    [Test]
    public void Promotion_holds_the_zone_when_its_only_candidate_is_unbacked()
    {
        var source = new TakeoffResult {
            LevelName = "Level 1",
            Rooms = { Room("partial", (0, 0), (5, 0), (5, 10), (0, 10)) },
            DomainSqft = 50,
        };
        var options = Options(minimumRoomSqft: 0);
        options.SmallZoneSqft = 0;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("room", (0, 0), (10, 0), (10, 10), (0, 10)),
            options, (_, _) => double.PositiveInfinity);

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Triage!.Reason, Is.EqualTo("single-unbacked-room"));
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Result.Residues.Single().RawSqft, Is.EqualTo(100).Within(1e-9));
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
    public void Held_merged_room_restores_every_source_partition_partner()
    {
        var survivor = Room("survivor", (0, 0), (10, 5), (0, 10), (0, 8), (0, 2));
        survivor.RawSqft = 50;
        var partner = Room("partner", (-2, 2), (0, 2), (0, 8), (-2, 8));
        partner.RawSqft = 12;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { survivor, partner }, DomainSqft = 62,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 0);
        options.AbsorbNeighborMaxSqft = 20;
        options.AbsorbNeighborSharedPerimeterFraction = 0.3;
        options.EdgeBandFt = 0;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (-2, 0), (10, 0), (10, 10), (-2, 10)),
            options, (_, _) => 0, TestContext.Out.WriteLine);

        Assert.Multiple(() => {
            Assert.That(promotion.Diagnostics.Rejections["absorb:merged"], Is.EqualTo(1));
            Assert.That(promotion.Result.Rooms, Is.Empty);
            Assert.That(promotion.Diagnostics.HeldSqft, Is.EqualTo(62).Within(1e-6));
            Assert.That(promotion.Diagnostics.ExcludedSqft, Is.EqualTo(58).Within(1e-6));
            Assert.That(promotion.Diagnostics.ClosureErrorSqft, Is.LessThan(1e-9));
        });
    }

    [Test]
    public void Held_rooms_keep_the_shared_network_candidate_not_the_raster_staircase()
    {
        var left = Room("left", (0, 0), (5, 0), (5, 2), (5.25, 2), (5.25, 4),
            (5, 4), (5, 6), (5.25, 6), (5.25, 8), (5, 8), (5, 10), (0, 10));
        var right = Room("right", (5, 0), (10, 0), (10, 10), (5, 10), (5, 8),
            (5.25, 8), (5.25, 6), (5, 6), (5, 4), (5.25, 4), (5.25, 2), (5, 2));
        left.RawSqft = right.RawSqft = 50;
        var source = new TakeoffResult {
            LevelName = "Level 1", Rooms = { left, right }, DomainSqft = 100,
        };
        var options = Options(minimumRoomSqft: 0, boundarySimplifyFt: 2);
        options.InkBackedAcceptMin = 1;
        options.AbsorbNeighborMaxSqft = 0;
        options.EdgeBandFt = 0;

        var promotion = TakeoffPromotion.PromoteZone(
            source, Zone("all", (0, 0), (10, 0), (10, 10), (0, 10)),
            options, (_, _) => 100, TestContext.Out.WriteLine);

        var held = promotion.Result.Residues
            .Where(residue => residue.Reason == ResidueReason.Rejected).ToList();
        Assert.That(held, Has.Count.EqualTo(2));
        Assert.Multiple(() => {
            Assert.That(held.Max(residue => residue.Polygon.Count), Is.LessThan(12),
                "Held is a review candidate; restoring the raw raster boundary makes it unsalvageable.");
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
