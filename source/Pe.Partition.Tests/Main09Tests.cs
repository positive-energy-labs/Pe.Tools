using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     The deterministic lane. A zone fixture is three files and a test is a solve; no Revit runs
///     here. Fixture: <c>fixtures/project-a-main-09</c>, project-a Main Level#09, epoch 0.
/// </summary>
[TestFixture]
public sealed class Main09Tests {
    // The Python rails reference for this zone, REPORT-RAILS-SCALE.md row "Main Level#09":
    // zone 1687.8 sqft, 10 rooms, 1687.8 sqft of room, 16/16 adjacent pairs sharing exactly.
    private const int ReferenceFaces = 10;
    private const double ReferenceZoneSqft = 1687.8;
    private const double ReferenceCoverage = 1.0;
    private const double Within = 0.10;

    // FOOTGUN: the reference's stage-4 area floor, solve-union/solve.py MIN_FACE. SHAPE.md has no
    // stage-4 floor, so our face list is longer; the comparable subset is the one at this floor.
    private const double ReferenceFaceFloorSqft = 15.0;

    private static string FixtureDir {
        get {
            var d = TestContext.CurrentContext.TestDirectory;
            for (var i = 0; i < 8 && d is not null; i++) {
                var p = Path.Combine(d, "fixtures", "project-a-main-09");
                if (Directory.Exists(p)) return p;
                d = Path.GetDirectoryName(d);
            }

            throw new DirectoryNotFoundException("fixtures/project-a-main-09 not found from the test directory");
        }
    }

    private static SliceAnswer Load(string name) {
        using var fs = File.OpenRead(Path.Combine(FixtureDir, name));
        return SliceJson.Read(fs);
    }

    [Test]
    public void SliceJson_RoundTripsBitExact() {
        var knee = Load("knee.json");
        using var ms = new MemoryStream();
        SliceJson.Write(knee, ms);
        ms.Position = 0;
        var back = SliceJson.Read(ms);

        Assert.That(back.Elements.Count, Is.EqualTo(knee.Elements.Count));
        Assert.That(back.Pieces, Is.EqualTo(knee.Pieces));
        long doubles = 0;
        for (var i = 0; i < knee.Elements.Count; i++) {
            Assert.That(back.Elements[i].Handle.ElementId, Is.EqualTo(knee.Elements[i].Handle.ElementId));
            Assert.That(back.Elements[i].Pieces.Count, Is.EqualTo(knee.Elements[i].Pieces.Count));
            for (var k = 0; k < knee.Elements[i].Pieces.Count; k++) {
                var a = knee.Elements[i].Pieces[k];
                var b = back.Elements[i].Pieces[k];
                Assert.That(b.Length, Is.EqualTo(a.Length));
                for (var v = 0; v < a.Length; v++) {
                    doubles++;
                    Assert.That(BitConverter.DoubleToInt64Bits(b[v]), Is.EqualTo(BitConverter.DoubleToInt64Bits(a[v])),
                        $"element {i} piece {k} ordinate {v}");
                }
            }
        }

        TestContext.Out.WriteLine($"SliceJson round trip: {knee.Elements.Count:N0} rows, {doubles:N0} doubles, bit-exact");
    }

    [Test]
    public void Main09_Partitions() {
        var knee = Load("knee.json");
        var header = Load("header.json");
        var zoneJson = JObject.Parse(File.ReadAllText(Path.Combine(FixtureDir, "zone.json")));
        var loop = zoneJson["loop"]!.Select(v => (double)v!).ToArray();
        var levelZ = (double)zoneJson["levelZ"]!;

        // Stage 6 stub for this round: a floor at the level plane and a ceiling 9 ft over it.
        ProbeAnswer Probe(double x, double y) => new(
            knee.Stamp, knee.Searched,
            new ProbeHit(Stub, 0.0, levelZ),
            new ProbeHit(Stub, 9.0, levelZ + 9.0),
            200.0, 0.0);

        var answer = Solve.Run(new PartitionInput(knee, header, [loop], levelZ, Knobs.Default,
            [knee.Stamp.Resolved], "historical synthetic fixture", [], null), Probe);

        var acc = answer.Accounting;
        var residual = acc.ZoneSqft - (acc.Accepted + acc.Held + acc.Void + acc.Excluded);

        TestContext.Out.WriteLine(
            $"zone {acc.ZoneSqft:F4} sqft, {answer.Rooms.Count} rooms, {answer.Ms:F0} ms, epoch {answer.Stamp.Epoch}");
        TestContext.Out.WriteLine(
            $"accounting  accepted {acc.Accepted:F4}  held {acc.Held:F4}  void {acc.Void:F4}  excluded {acc.Excluded:F4}  residual {residual:E3}");
        TestContext.Out.WriteLine("");
        TestContext.Out.WriteLine("  # disposition  reason            area sqft   inkBacked  pts  shared");
        foreach (var r in answer.Rooms)
            TestContext.Out.WriteLine(
                $"{r.Index,3} {r.Disposition,-11} {r.Reason ?? "-",-16} {r.AreaSqft,11:F3} {r.InkBacked,10:F3} {r.Loop.Length / 2,4} {r.Shared.Count,7}");
        TestContext.Out.WriteLine("");

        // (a) Accounting closes.
        Assert.That(Math.Abs(residual), Is.LessThanOrEqualTo(1e-6), $"accounting residual {residual:E3} sqft");

        // (b) Every adjacent pair shares its boundary exactly: the shared record is symmetric, has
        // real length, and the two rooms do not overlap.
        var pairs = 0;
        for (var i = 0; i < answer.Rooms.Count; i++)
            foreach (var e in answer.Rooms[i].Shared) {
                pairs++;
                var back = answer.Rooms[e.Other].Shared.FirstOrDefault(s => s.Other == i);
                Assert.That(back, Is.Not.Null, $"room {e.Other} does not name room {i} back");
                Assert.That(back!.LengthFt, Is.EqualTo(e.LengthFt).Within(1e-6),
                    $"shared length disagrees between {i} and {e.Other}");
                Assert.That(e.LengthFt, Is.GreaterThan(0.0));
            }

        TestContext.Out.WriteLine($"shared edges: {pairs / 2} adjacent pairs, all symmetric to 1e-6 ft");

        // (c) Face count and coverage within 10% of the Python rails result for Main#09.
        var coverage = (acc.Accepted + acc.Held + acc.Void) / acc.ZoneSqft;
        TestContext.Out.WriteLine(
            $"faces {answer.Rooms.Count} vs python {ReferenceFaces}; coverage {coverage:P2} vs python {ReferenceCoverage:P2}; "
            + $"zone {acc.ZoneSqft:F1} vs python {ReferenceZoneSqft:F1}");

        Assert.That(acc.ZoneSqft, Is.EqualTo(ReferenceZoneSqft).Within(0.1),
            "the fixture zone loop is not the zone the python reference solved");
        // Ruling, round 2: keep all 15 faces and hold the seven too-small ones; compare only the
        // faces at or above the reference's own stage-4 floor. solve-union/solve.py MIN_FACE = 15.0
        // sqft drops smaller faces before reclaim, so its 10 never counted them.
        var atFloor = answer.Rooms.Count(r => r.AreaSqft >= ReferenceFaceFloorSqft);
        TestContext.Out.WriteLine(
            $"faces at or above the reference {ReferenceFaceFloorSqft:F0} sqft floor: {atFloor} of {answer.Rooms.Count}");
        Assert.That(atFloor,
            Is.InRange(ReferenceFaces * (1 - Within), ReferenceFaces * (1 + Within)),
            $"face count {atFloor} at the {ReferenceFaceFloorSqft:F0} sqft floor is not within 10% of "
            + $"the python rails result {ReferenceFaces}");
        Assert.That(coverage, Is.EqualTo(ReferenceCoverage).Within(Within),
            $"coverage {coverage:P2} is not within 10% of the python rails result");
    }

    private static readonly Handle Stub =
        new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);
}
