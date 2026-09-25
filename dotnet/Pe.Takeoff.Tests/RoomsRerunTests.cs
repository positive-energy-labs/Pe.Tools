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
        var plan = RoomsRerun.Plan([], [], [], [Room("R01", 5, 5, 100), Room("R02", 15, 5, 100)], [Residue("R03")], null);
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
        var plan = RoomsRerun.Plan([matched, gone], [], [], [kept, fresh], [], null);
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
        var plan = RoomsRerun.Plan([], [], [locked], [echo, native], [heldEcho], null);
        Assert.Multiple(() => {
            Assert.That(plan.Locked.Single(), Is.SameAs(locked));
            Assert.That(plan.Delete, Is.Empty);
            Assert.That(plan.Keep, Is.Empty);
            Assert.That(plan.Create.Single(), Is.SameAs(native));
            Assert.That(plan.CreateHeld, Is.Empty);
        });
        Assert.Throws<InvalidOperationException>(() => RoomsRerun.Plan([locked], [], [locked], [], [], null));
    }

    [Test]
    public void Held_residue_is_deleted_and_redrawn()
    {
        var oldHeld = Region(3, 0, 0, 4, 4);
        var newHeld = Residue("R05");
        var plan = RoomsRerun.Plan([], [oldHeld], [], [], [newHeld], null);
        Assert.Multiple(() => {
            Assert.That(plan.Delete.Single(), Is.SameAs(oldHeld));
            Assert.That(plan.CreateHeld.Single(), Is.SameAs(newHeld));
        });
    }

    [Test]
    public void Zone_that_solves_to_one_face_is_the_room_and_its_machine_children_go()
    {
        var child = Region(1, 0, 0, 10, 10);
        var oldHeld = Region(2, 10, 0, 11, 10);
        var sole = Room("R01", 5, 5, 99.5);
        var plan = RoomsRerun.Plan([child], [oldHeld], [], [sole], [Residue("R02")], 100);
        Assert.Multiple(() => {
            Assert.That(plan.Redesignate, Is.SameAs(sole));
            Assert.That(plan.Delete, Is.EqualTo(new[] { child, oldHeld }));
            Assert.That(plan.Create, Is.Empty);
            Assert.That(plan.CreateHeld, Is.Empty);
            Assert.That(plan.Keep, Is.Empty);
        });
        // Under the share, two faces, a person's room inside, or a person's zone: the zone stays a zone.
        var locked = Region(3, 0, 0, 2, 2);
        Assert.Multiple(() => {
            Assert.That(RoomsRerun.Plan([], [], [], [Room("R01", 5, 5, 98)], [], 100).Redesignate, Is.Null);
            Assert.That(RoomsRerun.Plan([], [], [], [sole, Room("R02", 1, 1, 0.5)], [], 100).Redesignate, Is.Null);
            Assert.That(RoomsRerun.Plan([], [], [locked], [sole], [], 100).Redesignate, Is.Null);
            Assert.That(RoomsRerun.Plan([], [], [], [sole], [], null).Redesignate, Is.Null);
        });
    }

    [Test]
    public void Zone_whose_sole_face_is_held_is_the_room_too()
    {
        // Duryee's garage: one 737.2 sf face held zone-edge-only in a 740.9 sf zone.
        var child = Region(1, 0, 0, 10, 10);
        var garage = new ResidueResult { Id = "R01", RawSqft = 737.2, LabelX = 5, LabelY = 6, MeanCeilingFt = 9,
            Polygon = [[0, 0], [10, 0], [10, 10]] };
        var plan = RoomsRerun.Plan([], [child], [], [], [garage], 740.9);
        Assert.Multiple(() => {
            Assert.That(plan.Redesignate, Is.Not.Null);
            Assert.That(plan.Redesignate!.RawSqft, Is.EqualTo(737.2));
            Assert.That(plan.Redesignate.Polygon, Is.SameAs(garage.Polygon));
            Assert.That(plan.Delete.Single(), Is.SameAs(child));
            Assert.That(plan.CreateHeld, Is.Empty);
            // A person's zone never flips; two held faces are not one.
            Assert.That(RoomsRerun.Plan([], [], [], [], [garage], null).Redesignate, Is.Null);
            Assert.That(RoomsRerun.Plan([], [], [], [], [garage, Residue("R02")], 740.9).Redesignate, Is.Null);
        });
    }

    // Duryee Level 1, zone 6692266, the 719.4 sf great room (rails d243ad92): FilledRegion.Create refused it
    // (R14) because a vertex at (-11.72, 263.20) runs 0.19 ft out and back along one line, off it by 1e-7 ft.
    private static readonly double[] GreatRoom = [11.3746, 244.5652, 11.3746, 242.0716, 11.3746, 241.9882, 10.1454, 241.9882, 10.1454, 241.4959, 0.5048, 241.4959, 0.5048, 241.4825, 0.5048, 240.6492, 0.7965, 240.6492, 0.7965, 240.6491713945681, 0.7964729869935696, 240.6491713945681, 0.7964729869935546, 231.24561085079318, -14.8358, 231.2456108507932, -14.8358, 236.4724, -14.8566, 236.4724, -14.8566, 241.6169, -14.8358, 241.6169, -14.8358, 245.2701, -13.9483, 245.2701, -12.9541, 245.2701, -12.1668, 245.2701, -12.1668, 245.27010826882997, -12.166789243457357, 245.27010826882997, -12.166789243457357, 245.3944, -12.0583, 245.3944, -12.0583, 247.9777, -11.85, 247.9777, -11.8469, 248.2389, -11.777, 254.1791, -11.985373326699953, 254.1791, -11.985373326699948, 256.7624, -11.985373326699948, 257.05167149407714, -11.9854, 257.05167149407714, -11.9854, 257.0517, -12.9541, 257.0517, -17.4237, 257.0517, -17.6203, 257.0517, -17.6203, 264.1763, -17.6203, 267.5116, -17.6203, 269.2064, -17.6091, 269.2064, -14.2408, 269.2064, -14.1575, 269.2064, -14.1575, 269.1647, -14.095, 269.1647, -14.095, 268.9564, -14.095, 263.1194, -11.9075, 263.1194, -11.777, 263.1194, -11.5325, 263.1194, -11.5325, 263.2027, -11.7188, 263.2027, -11.7188, 263.2027130713546, 1.3067701280541666, 263.2027130713546, 1.306770128054168, 263.7287547390284, 1.3068, 263.7287547390284, 10.2288, 263.7287547390283, 10.4788, 263.7287547390283, 10.4788, 263.3434, 10.4788, 254.8225, 10.4788, 254.5308, 10.3746, 254.5308, 10.3746, 252.8892, 10.3746, 248.9637, 10.3746, 248.754, 10.3746, 248.3892, 10.3746, 245.3892, 10.3746, 244.7944, 11.3746, 244.7944];

    [Test]
    public void Clean_ring_drops_the_retrace_revit_refused_and_keeps_the_room()
    {
        var raw = Enumerable.Range(0, GreatRoom.Length / 2).Select(i => new[] { GreatRoom[2 * i], GreatRoom[2 * i + 1] }).ToList();
        var clean = Kernel.CleanRing(raw);
        var n = clean.Count;
        Assert.Multiple(() => {
            Assert.That(n, Is.LessThan(raw.Count));
            Assert.That(Math.Abs(Kernel.Shoelace(clean)), Is.EqualTo(Math.Abs(Kernel.Shoelace(raw))).Within(0.5));
            for (int i = 0; i < n; i++)
            {
                double[] a = clean[(i + n - 1) % n], b = clean[i], c = clean[(i + 1) % n];
                double abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
                Assert.That(Math.Sqrt(abx * abx + aby * aby), Is.GreaterThan(Kernel.WeldFt), $"short edge into {i}");
                var cos = ((abx * bcx) + (aby * bcy)) / Math.Sqrt((abx * abx + aby * aby) * (bcx * bcx + bcy * bcy));
                Assert.That(cos, Is.GreaterThan(-0.99), $"retrace at {i} ({b[0]:F2}, {b[1]:F2})");
            }
            Assert.That(clean.Any(p => Math.Abs(p[0] - -11.7188) < 0.01 && Math.Abs(p[1] - 263.2027) < 0.01), Is.False);
        });
    }

    [Test]
    public void Clean_ring_of_a_sliver_is_degenerate()
    {
        Assert.That(Kernel.CleanRing([[0, 0], [5, 0], [5, 0.002], [0, 0.003]]), Is.Empty);
    }

    [Test]
    public void Architect_name_fills_an_empty_name_and_never_overwrites()
    {
        RoomResult Named(string name) => new()
        {
            Partition = new Pe.Revit.Partition.Room(0, Pe.Revit.Partition.Disposition.Accepted, null, [], 100, 0, 0,
                1, null, null, [], Proposal: new Pe.Revit.Partition.RoomProposal("host|host|x", name, "101", [])),
        };
        Assert.Multiple(() => {
            Assert.That(Rooms.ProposedName(Named("Kitchen"), ""), Is.EqualTo("Kitchen"));
            Assert.That(Rooms.ProposedName(Named("Kitchen"), "Pantry"), Is.Null);
            Assert.That(Rooms.ProposedName(Named(""), ""), Is.Null);
            Assert.That(Rooms.ProposedName(Room("R01", 0, 0, 100), ""), Is.Null);
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
