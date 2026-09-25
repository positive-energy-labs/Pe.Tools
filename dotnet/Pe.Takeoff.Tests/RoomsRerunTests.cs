using NUnit.Framework;

using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// The /rooms rerun rule: locked stays, untouched machine regions rebind by geometry, held residue is
// redrawn, and a room that came back from a locked proposal is never created again.
public sealed class RoomsRerunTests
{
    private static RoomResult Room(string id, double lx, double ly, double sqft, string? source = null) =>
        new()
        {
            Id = id, LabelX = lx, LabelY = ly, RawSqft = sqft,
            Partition = source == null ? null : new Pe.Revit.Partition.Room(0,
                Pe.Revit.Partition.Disposition.Accepted, null, [], sqft, lx, ly, 1, null, null, [],
                Proposal: new Pe.Revit.Partition.RoomProposal(source, "", "", [])),
        };

    private static ResidueResult Residue(string id, string? source = null) =>
        new()
        {
            Id = id,
            Partition = source == null ? null : new Pe.Revit.Partition.Room(0,
                Pe.Revit.Partition.Disposition.Held, "no-floor", [], 10, 0, 0, 0, null, null, [],
                Proposal: new Pe.Revit.Partition.RoomProposal(source, "", "", [])),
        };

    private static ExistingRegion Region(long id, double x0, double y0, double x1, double y1) =>
        new(id, Guid.NewGuid(),
            [new List<double[]> { new[] { x0, y0 }, new[] { x1, y0 }, new[] { x1, y1 }, new[] { x0, y1 } }],
            (x1 - x0) * (y1 - y0));

    [Test]
    public void First_run_creates_every_room_and_residue()
    {
        var plan = RoomsRerun.Plan([], [], [], [Room("R01", 5, 5, 100), Room("R02", 15, 5, 100)], [Residue("R03")]);
        Assert.Multiple(() => {
            Assert.That(plan.Create.Select(r => r.Id), Is.EqualTo(new[] { "R01", "R02" }));
            Assert.That(plan.CreateHeld.Select(r => r.Id), Is.EqualTo(new[] { "R03" }));
            Assert.That(plan.Keep, Is.Empty);
            Assert.That(plan.Delete, Is.Empty);
        });
    }

    [Test]
    public void Rerun_keeps_matched_and_deletes_unmatched()
    {
        var matched = Region(1, 0, 0, 10, 10);
        var gone = Region(2, 20, 0, 30, 10);
        var kept = Room("R01", 5, 5, 100);
        var fresh = Room("R02", 45, 5, 100);
        var plan = RoomsRerun.Plan([matched, gone], [], [], [kept, fresh], []);
        Assert.Multiple(() => {
            Assert.That(plan.Keep.Single().Room, Is.SameAs(kept));
            Assert.That(plan.Keep.Single().Region, Is.SameAs(matched));
            Assert.That(plan.Delete.Single(), Is.SameAs(gone));
            Assert.That(plan.Create.Single(), Is.SameAs(fresh));
        });
    }

    [Test]
    public void Locked_is_never_deleted_or_recreated()
    {
        var locked = Region(7, 0, 0, 10, 10);
        var echo = Room("R01", 5, 5, 100, RoomsRerun.LockedPrefix + locked.Guid.ToString("D"));
        var heldEcho = Residue("R02", RoomsRerun.LockedPrefix + Guid.NewGuid().ToString("D"));
        var native = Room("R03", 15, 5, 100, "host|host|room-unique-id");
        var plan = RoomsRerun.Plan([], [], [locked], [echo, native], [heldEcho]);
        Assert.Multiple(() => {
            Assert.That(plan.Locked.Single(), Is.SameAs(locked));
            Assert.That(plan.Delete, Is.Empty);
            Assert.That(plan.Keep, Is.Empty);
            Assert.That(plan.Create.Single(), Is.SameAs(native));
            Assert.That(plan.CreateHeld, Is.Empty);
        });
        Assert.Throws<InvalidOperationException>(() => RoomsRerun.Plan([locked], [], [locked], [], []));
    }

    [Test]
    public void Held_residue_is_deleted_and_redrawn()
    {
        var oldHeld = Region(3, 0, 0, 4, 4);
        var newHeld = Residue("R05");
        var plan = RoomsRerun.Plan([], [oldHeld], [], [], [newHeld]);
        Assert.Multiple(() => {
            Assert.That(plan.Delete.Single(), Is.SameAs(oldHeld));
            Assert.That(plan.CreateHeld.Single(), Is.SameAs(newHeld));
        });
    }

    [Test]
    public void Held_field_edit_claims_custody_but_noop_does_not()
    {
        var provenance = new RegionProvenance(1, Guid.NewGuid(), "machine-run", "source-room", 12)
            { GeometryHash = "geometry", WallHash = "wall", Flags = ["stale"] };
        var before = new RoomFields("", "hall", null, null, null, null, null, null);
        var changed = before with { Name = "Authored Held" };
        var authored = Rooms.AuthorHeldIfEdited(provenance, before, changed);
        Assert.Multiple(() => {
            Assert.That(Rooms.AuthorHeldIfEdited(provenance, before, before), Is.SameAs(provenance));
            Assert.That(authored.Flags, Does.Contain(Rooms.FlagAuthored));
            Assert.That(authored.RunId, Is.EqualTo(provenance.RunId));
            Assert.That(authored.SourceRoomId, Is.EqualTo(provenance.SourceRoomId));
            Assert.That(authored.GeometryHash, Is.EqualTo(provenance.GeometryHash));
            Assert.That(authored.WallHash, Is.EqualTo(provenance.WallHash));
        });
    }

    [Test]
    public void Designation_reads_interior_walls_first_and_area_only_without_evidence()
    {
        List<List<double[]>> fill = [[[0, 0], [20, 0], [20, 20], [0, 20]]];
        double[] crossing = [10, 0, 10, 20];
        double[] onEdge = [0, 0, 20, 0];
        List<List<double[]>> big = [[[0, 0], [20, 0], [20, 20], [0, 20]]];
        List<List<double[]>> small = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
        Assert.Multiple(() => {
            Assert.That(Rooms.Designate([crossing], fill, 400), Is.EqualTo(TakeoffCarriers.RoleZoningRegion));
            Assert.That(Rooms.Designate([onEdge], fill, 400), Is.EqualTo(TakeoffCarriers.RoleRoomRegion));
            Assert.That(Rooms.Designate([], big, 400), Is.EqualTo(TakeoffCarriers.RoleZoningRegion));
            Assert.That(Rooms.Designate([], small, 100), Is.EqualTo(TakeoffCarriers.RoleRoomRegion));
        });
    }

    [Test]
    public void Geometry_hash_is_hex_sha256_stable_under_sub_micro_noise()
    {
        List<List<double[]>> a = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
        List<List<double[]>> b = [[[-1e-9, 0], [10 + 1e-8, 0], [10, 10], [0, 10]]];
        List<List<double[]>> moved = [[[0, 0], [10.01, 0], [10, 10], [0, 10]]];
        Assert.Multiple(() => {
            Assert.That(Rooms.GeometryHash(a), Does.Match("^[0-9a-f]{64}$"));
            Assert.That(Rooms.GeometryHash(b), Is.EqualTo(Rooms.GeometryHash(a)));
            Assert.That(Rooms.GeometryHash(moved), Is.Not.EqualTo(Rooms.GeometryHash(a)));
        });
    }

    [Test]
    public void Wall_hash_sees_only_pieces_within_a_foot_and_ignores_order()
    {
        List<List<double[]>> region = [[[0, 0], [10, 0], [10, 10], [0, 10]]];
        double[] near = [10.5, 0, 11, 0, 11, 10];
        double[] far = [20, 0, 21, 0, 21, 10];
        double[] alsoNear = [-0.5, 0, 0, 0, 0, 10];
        Assert.Multiple(() => {
            Assert.That(Rooms.WallHash([near, far], region), Is.EqualTo(Rooms.WallHash([near], region)));
            Assert.That(Rooms.WallHash([near, alsoNear], region), Is.EqualTo(Rooms.WallHash([alsoNear, near], region)));
            Assert.That(Rooms.WallHash([near, alsoNear], region), Is.Not.EqualTo(Rooms.WallHash([near], region)));
        });
    }
}
