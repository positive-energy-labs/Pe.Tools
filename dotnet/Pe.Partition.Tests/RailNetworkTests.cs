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
        var faces = Rails.Faces(net);
        var domain = Pe.Revit.Partition.Solve.GeometryOf([zone]);
        Assert.That(faces.Sum(f => f.Area), Is.EqualTo(domain.Area).Within(1e-6), "faces must tile the zone");
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
}
