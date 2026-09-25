using NUnit.Framework;

using Pe.Revit.Takeoff;
using Pe.Shared.RevitData.Takeoffs;

namespace Pe.Takeoff.Tests;

// rooms.merge, pure: rooms and held regions of one zone on one view, at most one RHVAC link, one polygon.
public sealed class RoomsMergeTests
{
    private static readonly Guid Zone = Guid.NewGuid();

    private static List<List<double[]>> Box(double x0, double y0, double x1, double y1) =>
        [[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]];

    private static MergeMember Member(List<List<double[]>> loops, double sqft = 100, string role = "room-region",
        Guid? zone = null, long view = 1, TakeoffRhvacLink? link = null) =>
        new(Guid.NewGuid(), view, role, zone ?? Zone, sqft, loops, link);

    private static double Area(List<double[]> ring) => Kernel.Shoelace(ring);

    [Test]
    public void Touching_rooms_make_one_polygon_with_the_largest_members_fields()
    {
        var small = Member(Box(0, 0, 10, 10), 100);
        var big = Member(Box(10, 0, 30, 10), 200, "held-residue");
        var plan = RoomsMerge.Plan(1, [small, big]);
        Assert.Multiple(() => {
            Assert.That(Area(plan.Outer), Is.EqualTo(300).Within(1e-6), "outer is CCW");
            Assert.That(plan.Holes, Is.Empty);
            Assert.That(plan.Largest, Is.SameAs(big));
            Assert.That(plan.Zone, Is.EqualTo(Zone));
        });
    }

    [Test]
    public void A_seam_Revit_stored_apart_closes_and_a_ring_keeps_its_hole()
    {
        var seam = RoomsMerge.Union([Box(0, 0, 10, 10), Box(10.004, 0, 20, 10)]);
        Assert.That(Area(seam.Outer), Is.EqualTo(200).Within(0.1));
        // Four rooms around a 10x10 court.
        var ring = RoomsMerge.Union([Box(0, 0, 30, 10), Box(0, 20, 30, 30), Box(0, 10, 10, 20), Box(20, 10, 30, 20)]);
        Assert.Multiple(() => {
            Assert.That(Area(ring.Outer), Is.EqualTo(900).Within(1e-6));
            Assert.That(Area(ring.Holes.Single()), Is.EqualTo(-100).Within(1e-6), "the hole is CW");
        });
    }

    [Test]
    public void Refuses_what_is_not_one_zones_touching_rooms()
    {
        var link = new TakeoffRhvacLink(4, "a.rhv", "t", 100);
        var a = Box(0, 0, 10, 10);
        var b = Box(10, 0, 20, 10);
        void Refused(string why, params MergeMember[] members) =>
            Assert.Throws<InvalidOperationException>(() => RoomsMerge.Plan(1, members), why);
        Assert.Multiple(() => {
            Refused("one region", Member(a));
            Refused("a wall's width apart", Member(a), Member(Box(10.5, 0, 20, 10)));
            Refused("corner touch is two pieces", Member(a), Member(Box(10, 10, 20, 20)));
            Refused("a zone", Member(a), Member(b, role: "zoning-region"));
            Refused("two zones", Member(a), Member(b, zone: Guid.NewGuid()));
            Refused("no zone", Member(a), new MergeMember(Guid.NewGuid(), 1, "room-region", null, 100, b, null));
            Refused("another view", Member(a), Member(b, view: 2));
            Refused("two links", Member(a, link: link), Member(b, link: link with { Identifier = 5 }));
            var twice = Member(a);
            Refused("twice", twice, twice);
        });
        // One link rides along even from the smaller member; the same link on both is one link.
        Assert.Multiple(() => {
            Assert.That(RoomsMerge.Plan(1, [Member(a, 50, link: link), Member(b, 100)]).Rhvac, Is.EqualTo(link));
            Assert.That(RoomsMerge.Plan(1, [Member(a, link: link), Member(b, link: link with { SyncedAt = "u" })]).Rhvac, Is.Not.Null);
        });
    }
}
