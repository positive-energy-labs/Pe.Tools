using NetTopologySuite.Geometries;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>Synthetic layouts from the rails brief: junctions, openings and faces on known answers.</summary>
public sealed class RailNetworkTests {
    private static readonly Handle H = new("doc", 1, "u", null, "Walls", PrimKind.Solid);

    private static Rail R(double x0, double y0, double x1, double y1, double t = 0.5) => new([x0, y0], [x1, y1], t, "synthetic", H);

    private static double[] Box(double x0, double y0, double x1, double y1) => [x0, y0, x1, y0, x1, y1, x0, y1];

    private static (RailNetwork Net, IReadOnlyList<Polygon> Faces) Solve(double[] zone, OpeningEvidence? ev, params Rail[] rails) {
        var net = Rails.Network(rails, [zone], ev ?? OpeningEvidence.None);
        var (faces, bands) = Rails.Faces(net);
        var domain = Pe.Revit.Partition.Solve.GeometryOf([zone]);
        Assert.That(faces.Sum(f => f.Area) + bands.Sum(b => b.Area), Is.EqualTo(domain.Area).Within(1e-6), "rooms and bands must tile the zone");
        for (var i = 0; i < faces.Count; i++)
            for (var j = i + 1; j < faces.Count; j++)
                Assert.That(faces[i].Intersection(faces[j]).Area, Is.LessThan(1e-6), $"overlap {i}/{j}");
        return (net, faces);
    }

    private static void AllOrthogonal(IEnumerable<Polygon> faces) {
        foreach (var f in faces) {
            var c = f.ExteriorRing.Coordinates;
            for (var k = 1; k < c.Length; k++)
                Assert.That(Math.Min(Math.Abs(c[k].X - c[k - 1].X), Math.Abs(c[k].Y - c[k - 1].Y)), Is.LessThan(1e-6), $"diagonal edge {c[k - 1]} {c[k]}");
        }
    }

    private static Polygon At(IReadOnlyList<Polygon> faces, double x, double y) =>
        faces.Single(f => f.Contains(new Point(x, y)));

    [Test]
    public void L_of_rooms_door_separates_and_cased_opening_joins() {
        // L zone: a 30x10 bar with a 10x20 arm up its left end. Exterior rails sit 0.25 ft inside the zone edge.
        var zone = new double[] { 0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30 };
        var door = new OpeningEvidence([[10.1, 3.2, 12.5, 3.2]], [], []);   // a door leaf drawn open from the jamb
        var (net, faces) = Solve(zone, door,
            R(0.25, 0.25, 29.75, 0.25), R(29.75, 0.25, 29.75, 9.75), R(29.75, 9.75, 10.25, 9.75),
            R(10.25, 9.75, 10.25, 29.75), R(10.25, 29.75, 0.25, 29.75), R(0.25, 29.75, 0.25, 0.25),
            R(10, 0.5, 10, 3), R(10, 6, 10, 9.5),     // door gap at y 3..6
            R(0.5, 10, 3, 10), R(6, 10, 9.75, 10),    // cased gap at x 3..6
            R(20, 0.5, 20, 9.5));                     // full divider
        Assert.That(net.Openings.Count(o => o.Kind == SegKind.Door), Is.EqualTo(1));
        Assert.That(net.Openings.Count(o => o.Kind == SegKind.Cased), Is.EqualTo(1));
        Assert.That(net.Openings.All(o => Math.Abs(o.WidthFt - 3) < 1e-9), Is.True);
        Assert.That(faces, Has.Count.EqualTo(3));
        Assert.That(At(faces, 5, 5), Is.SameAs(At(faces, 5, 20)), "cased opening joins the corner and the arm");
        Assert.That(At(faces, 5, 5), Is.Not.SameAs(At(faces, 15, 5)), "door separates");
        Assert.That(At(faces, 15, 5), Is.Not.SameAs(At(faces, 25, 5)));
        Assert.That(At(faces, 15, 5).Area, Is.EqualTo(10 * 10).Within(1e-6), "rooms run to the rail axis and the zone edge");
        AllOrthogonal(faces);
    }

    [Test]
    public void T_junction_meets_the_axis_square() {
        // The stem stops at the cross wall's face, 0.25 ft short of its axis.
        var (_, faces) = Solve(Box(0, 0, 20, 10), null, R(0, 5, 20, 5), R(10, 5.25, 10, 10));
        Assert.That(faces, Has.Count.EqualTo(3));
        AllOrthogonal(faces);
        Assert.That(At(faces, 5, 8).Area, Is.EqualTo(50).Within(1e-6));
        Assert.That(At(faces, 5, 8).Coordinates.Any(c => c.Distance(new Coordinate(10, 5)) < 1e-6), Is.True);
    }

    [Test]
    public void Bent_wall_corner_closes_on_both_extensions() {
        // Both legs stop short of the bend: neither reaches the other's axis.
        var (_, faces) = Solve(Box(0, 0, 20, 10), null, R(0, 5, 9.75, 5), R(10, 5.25, 10, 10));
        Assert.That(faces, Has.Count.EqualTo(2));
        AllOrthogonal(faces);
        Assert.That(At(faces, 5, 8).Area, Is.EqualTo(50).Within(1e-6));
    }

    [Test]
    public void One_foot_gap_closes() {
        var (net, faces) = Solve(Box(0, 0, 20, 10), null, R(10, 0, 10, 4.5), R(10, 5.5, 10, 10));
        Assert.That(net.Openings, Is.Empty);
        Assert.That(net.Segments.Count(s => s.Kind == SegKind.Closed), Is.EqualTo(1));
        Assert.That(faces, Has.Count.EqualTo(2));
    }

    [TestCase(false, false, SegKind.Cased, 1)]
    [TestCase(true, false, SegKind.Door, 2)]
    [TestCase(false, true, SegKind.Headed, 2)]
    public void Three_foot_gap_is_an_opening_not_a_wall(bool doorInk, bool headerInk, SegKind kind, int faceCount) {
        var ev = new OpeningEvidence(doorInk ? [[10, 3.6, 12.5, 3.6]] : [],
            headerInk ? [[9.75, 3, 9.75, 7], [10.25, 3, 10.25, 7]] : [], []);
        var (net, faces) = Solve(Box(0, 0, 20, 10), ev, R(10, 0, 10, 3.5), R(10, 6.5, 10, 10));
        Assert.That(net.Openings, Has.Count.EqualTo(1));
        Assert.That(net.Openings[0].Kind, Is.EqualTo(kind));
        Assert.That(net.Openings[0].WidthFt, Is.EqualTo(3).Within(1e-9));
        Assert.That(faces, Has.Count.EqualTo(faceCount));
    }

    [Test]
    public void Gap_filled_by_wall_ink_without_a_rail_is_wall_not_opening() {
        var ev = new OpeningEvidence([], [], [[9.75, 3.5, 9.75, 6.5], [10.25, 3.5, 10.25, 6.5]]);
        var (net, faces) = Solve(Box(0, 0, 20, 10), ev, R(10, 0, 10, 3.5), R(10, 6.5, 10, 10));
        Assert.That(net.Openings.Single().Kind, Is.EqualTo(SegKind.Closed));
        Assert.That(faces, Has.Count.EqualTo(2));
    }

    [Test]
    public void Wall_stopping_short_of_a_cross_wall_is_an_opening() {
        // The door sits at the room corner: the partition ends 3 ft short of the corridor wall's face.
        var ev = new OpeningEvidence([[10, 5, 12, 5]], [], []);
        var (net, faces) = Solve(Box(0, 0, 20, 10), ev, R(0, 7, 20, 7), R(10, 0, 10, 3.75));
        Assert.That(net.Openings.Single().Kind, Is.EqualTo(SegKind.Door));
        Assert.That(net.Openings.Single().WidthFt, Is.EqualTo(3).Within(1e-9));
        Assert.That(faces, Has.Count.EqualTo(3));
        AllOrthogonal(faces);
    }

    [Test]
    public void Envelope_rail_bounds_rooms_at_its_outer_face_and_the_band_is_set_aside() {
        // West envelope wall on x 0.75..1.25 (axis 1.0), zone edge at x 0; a cross wall stops at its inner face.
        var net = Rails.Network([R(1.0, 0, 1.0, 10), R(1.25, 5, 20, 5)], [Box(0, 0, 20, 10)], OpeningEvidence.None);
        var (rooms, bands) = Rails.Faces(net);
        Assert.That(rooms, Has.Count.EqualTo(2));
        Assert.That(bands, Has.Count.EqualTo(1));
        Assert.That(bands[0].Area, Is.EqualTo(0.75 * 10).Within(1e-6), "band runs from the outer face to the zone edge");
        Assert.That(Rails.Width(bands[0]), Is.EqualTo(0.75).Within(0.02));
        Assert.That(At(rooms, 5, 2).Area, Is.EqualTo(19.25 * 5).Within(1e-6), "room runs to the outer face, wall thickness included");
        Assert.That(At(rooms, 5, 2).Coordinates.Any(c => c.Distance(new Coordinate(0.75, 5)) < 1e-6), Is.True, "cross wall runs on to the outer face");
        AllOrthogonal(rooms);
    }

    [Test]
    public void Collinear_envelope_rails_with_a_gap_keep_the_band_out_of_the_room() {
        // A cased 3 ft gap in the envelope: the bar stays on the axis between the caps, the cased join takes the jamb
        // behind it into the room, and the bands behind the rails never merge with the room.
        var net = Rails.Network([R(1.0, 0, 1.0, 3.5), R(1.0, 6.5, 1.0, 10)], [Box(0, 0, 20, 10)], OpeningEvidence.None);
        var (rooms, bands) = Rails.Faces(net);
        Assert.That(net.Openings.Single().Kind, Is.EqualTo(SegKind.Cased));
        Assert.That(rooms.Single().Area, Is.EqualTo((19.25 * 10) + (0.75 * 3)).Within(1e-6));
        Assert.That(bands.Sum(b => b.Area), Is.EqualTo(0.75 * 7).Within(1e-6));
    }

    [Test]
    public void Cased_bar_joins_every_face_along_it_not_only_at_its_midpoint() {
        // An 8 ft cased bar on y 10 from x 4 to 12. Below it a wall at x 6 splits an alcove (x 0..6) from a room whose
        // edge carries the bar's midpoint (x 8): the alcove faces the hall above only along x 4..6.
        var zone = Box(0, 0, 20, 20);
        var z = Enumerable.Range(0, 4).Select(k => new RailSegment([zone[2 * k], zone[(2 * k) + 1]], [zone[(2 * k + 2) % 8], zone[(2 * k + 3) % 8]], SegKind.Zone));
        var bar = new Opening([4, 10], [12, 10], 8, SegKind.Cased, 0, 0, 0);
        var net = new RailNetwork([.. z,
            new RailSegment([0, 10], [4, 10], SegKind.Wall), new RailSegment([12, 10], [20, 10], SegKind.Wall),
            new RailSegment([6, 0], [6, 10], SegKind.Wall), new RailSegment(bar.A, bar.B, SegKind.Cased)], [bar], [zone]);
        var (rooms, bands) = Rails.Faces(net);
        Assert.That(bands, Is.Empty);
        Assert.That(rooms.Single().Area, Is.EqualTo(400).Within(1e-6), "alcove, midpoint room and hall are one room");
    }

    [Test]
    public void Cased_bar_is_a_floating_edge_and_a_wall_is_not() {
        var net = Rails.Network([R(10, 0, 10, 3.5), R(10, 6.5, 10, 10)], [Box(0, 0, 20, 10)], OpeningEvidence.None);
        var floating = Rails.Floating(net);
        var f = new GeometryFactory();
        Polygon Rect(double x0, double y0, double x1, double y1) => f.CreatePolygon([new(x0, y0), new(x1, y0), new(x1, y1), new(x0, y1), new(x0, y0)]);
        Assert.That(floating(Rect(0, 0, 10, 10)), Is.EqualTo(3).Within(0.01), "the 3 ft cased bar floats");
        Assert.That(floating(Rect(0, 0, 10, 3.5)), Is.EqualTo(10).Within(0.01), "a cut across the room floats");
    }

    // ---------------------------------------------------------------- Solve.RunRails on synthetic wall pieces

    /// <summary>A wall as its two long faces and end caps; vertical faces project to degenerate rings, as Duryee's IFC pieces do.</summary>
    private static double[][] Slab(double x0, double y0, double x1, double y1) => [
        [x0, y0, x1, y0, x1, y0, x0, y0], [x0, y1, x1, y1, x1, y1, x0, y1],
        [x0, y0, x0, y1, x0, y1, x0, y0], [x1, y0, x1, y1, x1, y1, x1, y0]];

    private static PartitionAnswer RunRails(double[] zone, params double[][][] walls) {
        var stamp = new Stamp("doc", 0, Stamp.HostInternalFt, DateTime.UnixEpoch, [], true, new Resolved([], [], [], [], []));
        var elements = walls.Select((w, k) => new SliceElement(new Handle("doc", k + 1, "u" + (k + 1), null, "Walls", PrimKind.Solid), w)).ToList();
        var knee = new SliceAnswer(stamp, new Searched(0, 0, 0, 0, 0), elements, elements.Sum(e => e.Pieces.Count), 0);
        var input = new PartitionInput(knee, knee with { Elements = [] }, [zone], 0, Knobs.Default, [], "test", [], null);
        var answer = Pe.Revit.Partition.Solve.RunRails(input, (_, _) => new ProbeAnswer(stamp, knee.Searched,
            new ProbeHit(H, 0, 0), new ProbeHit(H, 9, 9), 20, 0));
        var acc = answer.Accounting;
        Assert.That(acc.Accepted + acc.Held + acc.Void + acc.Excluded, Is.EqualTo(acc.ZoneSqft).Within(1e-6), "accounting closes");
        return answer;
    }

    [Test]
    public void Envelope_band_under_the_hold_width_is_excluded_wall() {
        // West wall faces at x 0.5 and 1.0; the zone edge is drawn 0.5 ft outside the wall. A divider at x 10 gives
        // the rooms an edge of their own (a lone face is zone-edge-only).
        var answer = RunRails(Box(0, 0, 20, 10), Slab(0.5, 0, 1.0, 10), Slab(9.75, 0, 10.25, 10));
        var band = answer.Rooms.Single(r => r.Disposition == Disposition.Excluded);
        Assert.That(band.Reason, Is.EqualTo(Reasons.Wall));
        Assert.That(band.AreaSqft, Is.EqualTo(0.5 * 10).Within(1e-6));
        Assert.That(answer.Rooms.Where(r => r.Disposition == Disposition.Accepted).Select(r => r.AreaSqft), Is.EquivalentTo(new[] { 95.0, 100.0 }).Using<double>((a, b) => Math.Abs(a - b) < 1e-6));
    }

    [Test]
    public void Envelope_band_wider_than_the_hold_width_is_held_with_its_width() {
        // The zone edge bulges 3 ft out past the west wall for 3 ft: the person drew the zone off the wall.
        var zone = new double[] { 0, 0, 20, 0, 20, 10, 0, 10, 0, 6.5, -3, 6.5, -3, 3.5, 0, 3.5 };
        var answer = RunRails(zone, Slab(0.5, 0, 1.0, 10), Slab(9.75, 0, 10.25, 10));
        var held = answer.Rooms.Single(r => r.Disposition == Disposition.Held);
        Assert.That(held.Reason, Is.EqualTo("envelope-band-3.0ft"));
        Assert.That(held.AreaSqft, Is.EqualTo((0.5 * 10) + (3 * 3)).Within(1e-6));
        Assert.That(answer.Rooms.Where(r => r.Disposition == Disposition.Accepted).Sum(r => r.AreaSqft), Is.EqualTo(19.5 * 10).Within(1e-6));
    }

    [TestCase(3.0, 4.0, Disposition.Accepted, null)]
    [TestCase(2.0, 2.5, Disposition.Held, Reasons.TooSmallTiny)]
    public void Rail_bounded_closet_is_a_room_down_to_six_square_feet(double w, double h, Disposition expected, string? reason) {
        // A closet on the south zone edge at x 8: wall axes at x 8, x 8 + w and y h; the zone edge closes it.
        var answer = RunRails(Box(0, 0, 20, 10),
            Slab(7.75, 0, 8.25, h + 0.25), Slab(7.75 + w, 0, 8.25 + w, h + 0.25), Slab(8.25, h - 0.25, 7.75 + w, h + 0.25));
        var closet = answer.Rooms.Single(r => Math.Abs(r.AreaSqft - (w * h)) < 1e-6);
        Assert.That(closet.Disposition, Is.EqualTo(expected));
        Assert.That(closet.Reason, Is.EqualTo(reason));
    }
}
