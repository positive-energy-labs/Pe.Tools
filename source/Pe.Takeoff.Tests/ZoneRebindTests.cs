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
            new List<double[]> { new[] { x0, y0 }, new[] { x1, y0 }, new[] { x1, y1 }, new[] { x0, y1 } },
            (x1 - x0) * (y1 - y0));

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
