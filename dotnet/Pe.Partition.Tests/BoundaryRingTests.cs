using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;

namespace Pe.Partition.Tests;

/// <summary>
///     The one boundary-joining seam behind zone loops and native Room proposals (<c>Verbs.Ring</c>): real Revit Room
///     boundaries leave sub-tolerance gaps between consecutive segments, and an open-plan Room has a genuinely open
///     boundary. The first joins; the second is named, never thrown or repaired, so Capture can drop that proposal.
/// </summary>
public sealed class BoundaryRingTests {
    private static IReadOnlyList<(double X, double Y, double Z)> Seg(double ax, double ay, double bx, double by) =>
        [(ax, ay, 0), (bx, by, 0)];

    [Test]
    public void Sub_tolerance_gap_joins_and_open_or_nonfinite_boundaries_are_named() {
        const double gap = 3.9e-4;
        var joined = Verbs.Ring([Seg(0, 0, 10, 0), Seg(10 + gap, 0, 10, 10), Seg(10, 10, 0, 10), Seg(0, 10, 0, gap)]);
        Assert.Multiple(() => {
            Assert.That(joined.Fault, Is.Null);
            Assert.That(joined.Ring, Is.EqualTo(new double[] { 0, 0, 10, 0, 10, 10, 0, 10 }));
            Assert.That(Verbs.Ring([Seg(0, 0, 10, 0), Seg(10.5, 0, 10, 10), Seg(10, 10, 0, 10), Seg(0, 10, 0, 0)]).Fault,
                Is.EqualTo("disconnected"));
            Assert.That(Verbs.Ring([Seg(0, 0, 10, 0), Seg(10, 0, 10, 10), Seg(10, 10, 0, 10), Seg(0, 10, 0, 0.5)]).Fault,
                Is.EqualTo("open or empty"));
            Assert.That(Verbs.Ring([Seg(0, 0, double.NaN, 0)]).Fault, Is.EqualTo("nonfinite"));
        });
    }

    /// <summary>Two live Room boundaries dumped from Revit (host feet, link transform applied), mileage 2026-09-26.</summary>
    [Test]
    public void Live_room_boundaries_join_or_are_named() {
        var closed = Load("project-d/partition");
        var open = Load("project-e/partition");
        var ring = Verbs.Ring(closed);
        Assert.Multiple(() => {
            Assert.That(closed, Has.Count.EqualTo(48));
            Assert.That(ring.Fault, Is.Null);
            Assert.That(ring.Ring, Has.Length.EqualTo(2 * 48));
            Assert.That(open, Has.Count.EqualTo(9));
            Assert.That(Verbs.Ring(open), Is.EqualTo(((double[]?)null, (string?)"disconnected")));
        });
    }

    private static List<IReadOnlyList<(double X, double Y, double Z)>> Load(string relative) =>
        JObject.Parse(File.ReadAllText(Path.Combine(PrivateFixtures.Dir(relative), "room-boundary.json")))["loops"]![0]!
            .Select(s => Seg((double)s["a"]![0]!, (double)s["a"]![1]!, (double)s["b"]![0]!, (double)s["b"]![1]!))
            .ToList();
}
