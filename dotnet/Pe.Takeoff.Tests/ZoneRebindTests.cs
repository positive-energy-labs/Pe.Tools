using NUnit.Framework;

using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// Geometric GUID re-binding: label-point containment + area +/-20%, ambiguity resolved by best
// area ratio, losers stay unmatched (asked, never guessed). Identity must be geometric, never rank.
public sealed class ZoneRebindTests
{
    private static RoomResult Room(string id, double lx, double ly, double sqft) =>
        new() { Id = id, LabelX = lx, LabelY = ly, RawSqft = sqft };

    private static ExistingRegion Region(long id, Guid guid, double x0, double y0, double x1, double y1) =>
        new(id, guid,
            [new List<double[]> { new[] { x0, y0 }, new[] { x1, y0 }, new[] { x1, y1 }, new[] { x0, y1 } }],
            (x1 - x0) * (y1 - y0));

    [Test]
    public void Rebind_does_not_claim_a_label_inside_an_existing_hole()
    {
        var region = Region(1, Guid.NewGuid(), 0, 0, 10, 10) with { Sqft = 84 };
        region.Loops.Add([[3, 3], [7, 3], [7, 7], [3, 7]]);
        var inHole = Room("R01", 5, 5, 84);
        var inRoom = Room("R02", 2, 2, 84);
        var rebind = ZoneMaterializer.Rebind([inHole, inRoom], [region]);
        Assert.Multiple(() => {
            Assert.That(rebind.Matched.Single().Room, Is.SameAs(inRoom));
            Assert.That(rebind.Unmatched.Single(), Is.SameAs(inHole));
            Assert.That(region.Loops, Has.Count.EqualTo(2));
        });
    }

    [TestCase(Pe.Revit.Partition.Disposition.Accepted, null)]
    [TestCase(Pe.Revit.Partition.Disposition.Held, "too-small")]
    [TestCase(Pe.Revit.Partition.Disposition.Void, "low-headroom")]
    [TestCase(Pe.Revit.Partition.Disposition.Excluded, "outside")]
    public void Provenance_retains_exact_partition_and_native_proposal_after_round_trip(
        Pe.Revit.Partition.Disposition disposition, string? reason)
    {
        double[] outer = [0.123456789012345, 0, 10, 0, 10, 10, 0, 10];
        double[] hole = [3, 3, 7, 3, 7, 7, 3, 7];
        var proposal = new Pe.Revit.Partition.RoomProposal("source-document|link-unique-id|room-unique-id",
            "Architectural Room", "101", [outer, hole]);
        var room = new Pe.Revit.Partition.Room(8, disposition, reason, outer, 84, 2, 2, 1,
            null, null, [], [hole], proposal);
        var provenance = new RegionProvenance(1, Guid.NewGuid(), "immutable-run", "R09", 84)
            { Partition = room };
        var loaded = RegionProvenance.FromJson(provenance.ToJson());
        // A normal provenance write must not drop fields after reading a saved blob.
        var rewritten = RegionProvenance.FromJson((loaded with { Flags = ["review-needed"] }).ToJson());
        Assert.Multiple(() => {
            Assert.That(loaded.ToJson(), Is.EqualTo(provenance.ToJson()));
            Assert.That(rewritten.Partition!.Disposition, Is.EqualTo(disposition));
            Assert.That(rewritten.Partition.Reason, Is.EqualTo(reason));
            Assert.That(rewritten.Partition.Proposal!.SourceKey, Is.EqualTo(proposal.SourceKey));
            Assert.That(rewritten.Partition.Proposal.Name, Is.EqualTo(proposal.Name));
            Assert.That(rewritten.Partition.Proposal.Number, Is.EqualTo(proposal.Number));
            Assert.That(rewritten.Partition.Proposal.Loops, Is.EqualTo(proposal.Loops));
            Assert.That(rewritten.Partition.Loop, Is.EqualTo(outer));
            Assert.That(rewritten.Partition.Holes!.Single(), Is.EqualTo(hole));
            Assert.That(rewritten.Partition.FloorZ, Is.Null);
            Assert.That(rewritten.Partition.CeilingZ, Is.Null);
            Assert.That(rewritten.RunId, Is.EqualTo("immutable-run"));
            Assert.That(rewritten.SourceRoomId, Is.EqualTo("R09"));
        });
    }

    [Test]
    public void Rebind_matches_by_containment_and_area_and_survives_rank_shuffle()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        var existing = new[] { Region(1, a, 0, 0, 10, 10), Region(2, b, 10, 0, 30, 10) };
        // ranks swapped relative to the existing order — anchors must not care
        var rooms = new[] { Room("R01", 20, 5, 205), Room("R02", 5, 5, 98) };

        var rebind = ZoneMaterializer.Rebind(rooms, existing);

        Assert.Multiple(() => {
            Assert.That(rebind.Matched, Has.Count.EqualTo(2));
            Assert.That(rebind.Matched.Single(m => m.Room.Id == "R02").Existing.Guid, Is.EqualTo(a));
            Assert.That(rebind.Matched.Single(m => m.Room.Id == "R01").Existing.Guid, Is.EqualTo(b));
            Assert.That(rebind.Unmatched, Is.Empty);
            Assert.That(rebind.Orphaned, Is.Empty);
        });
    }

    [Test]
    public void Rebind_leaves_area_drift_and_new_rooms_unmatched()
    {
        var existing = new[] { Region(1, Guid.NewGuid(), 0, 0, 10, 10) };
        var rooms = new[] {
            Room("R01", 5, 5, 150),   // inside but +50% area — a split/merge, not the same room
            Room("R02", 50, 5, 40),   // new room, outside every region
        };

        var rebind = ZoneMaterializer.Rebind(rooms, existing);

        Assert.Multiple(() => {
            Assert.That(rebind.Matched, Is.Empty);
            Assert.That(rebind.Unmatched.Select(r => r.Id), Is.EquivalentTo(new[] { "R01", "R02" }));
            Assert.That(rebind.Orphaned, Has.Count.EqualTo(1));
        });
    }

    [Test]
    public void Ambiguous_claims_resolve_to_best_area_ratio_and_loser_stays_unmatched()
    {
        var g = Guid.NewGuid();
        var existing = new[] { Region(1, g, 0, 0, 10, 10) };
        var rooms = new[] { Room("R01", 5, 5, 99), Room("R02", 6, 5, 110) };

        var rebind = ZoneMaterializer.Rebind(rooms, existing);

        Assert.Multiple(() => {
            Assert.That(rebind.Matched.Single().Room.Id, Is.EqualTo("R01"));
            Assert.That(rebind.Unmatched.Single().Id, Is.EqualTo("R02"));
        });
    }

    [Test]
    public void Provenance_codec_round_trips_and_fails_closed()
    {
        var provenance = new RegionProvenance(1, Guid.NewGuid(), "run-7", "R03", 212.5)
            { Flags = ["low-boundary-support"] };
        var loaded = RegionProvenance.FromJson(provenance.ToJson());
        Assert.Multiple(() => {
            Assert.That(loaded.Version, Is.EqualTo(provenance.Version));
            Assert.That(loaded.ZoneGuid, Is.EqualTo(provenance.ZoneGuid));
            Assert.That(loaded.RunId, Is.EqualTo(provenance.RunId));
            Assert.That(loaded.SourceRoomId, Is.EqualTo(provenance.SourceRoomId));
            Assert.That(loaded.SourceSqft, Is.EqualTo(provenance.SourceSqft));
            Assert.That(loaded.Flags, Is.EqualTo(provenance.Flags));
            Assert.Throws<InvalidOperationException>(() => RegionProvenance.FromJson("garbage"));
            Assert.Throws<InvalidOperationException>(() => RegionProvenance.FromJson(
                "{\"Version\":9,\"ZoneGuid\":\"" + Guid.NewGuid() + "\"}"));
        });
    }
}
