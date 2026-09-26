using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     A standing "not a room" (rooms ledger 2026-09-25) on Duryee Level 1's first zone: a rejected polygon equal to an
///     accepted room's loop holds that face as rejected and nothing else; scaled about its centroid to 70 percent of
///     the area (IoU 0.7) it still applies, to 30 percent (IoU 0.3) it does not.
/// </summary>
public sealed class RejectedTests {
    private static readonly Handle Stub = new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);

    [Test]
    public void Rejected_polygon_holds_its_face_by_overlap() {
        var dir = PrivateFixtures.Dir("duryee/partition");
        var level = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(Path.Combine(dir, "duryee-level-input.json")))!;
        var outer = JArray.Parse(File.ReadAllText(Path.Combine(dir, "duryee-locked.json"))).First(r => (double)r["Sqft"]! > 200)["Outer"]!;
        var input = level with {
            ZoneLoops = [outer.SelectMany(p => new[] { (double)p[0]!, (double)p[1]! }).ToArray()],
            Proposals = [],
            Knobs = level.Knobs with { FramingRails = true },
        };
        var bare = Run(input);
        var room = bare.Rooms.Where(r => r.Disposition == Disposition.Accepted).MaxBy(r => r.AreaSqft)!;

        string Diff(PartitionAnswer a) => string.Join(' ', a.Rooms.Zip(bare.Rooms)
            .Where(p => p.First.Disposition != p.Second.Disposition || p.First.Reason != p.Second.Reason)
            .Select(p => $"{p.First.Index}:{p.First.Disposition}/{p.First.Reason}"));

        Assert.That(Diff(Run(input with { Rejected = [room.Loop] })), Is.EqualTo($"{room.Index}:Held/{Reasons.Rejected}"));
        Assert.That(Diff(Run(input with { Rejected = [Scaled(room.Loop, 0.7)] })), Is.EqualTo($"{room.Index}:Held/{Reasons.Rejected}"));
        Assert.That(Diff(Run(input with { Rejected = [Scaled(room.Loop, 0.3)] })), Is.Empty);
    }

    // The ring scaled about its centroid to the given share of its area.
    private static double[] Scaled(double[] loop, double areaShare) {
        var c = Solve.GeometryOf([loop]).Centroid;
        var k = Math.Sqrt(areaShare);
        return loop.Select((v, i) => i % 2 == 0 ? c.X + ((v - c.X) * k) : c.Y + ((v - c.Y) * k)).ToArray();
    }

    private static PartitionAnswer Run(PartitionInput input) =>
        Solve.RunRails(input, (_, _) => new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched,
            new ProbeHit(Stub, 0.0, input.LevelZ), new ProbeHit(Stub, 9.0, input.LevelZ + 9.0), 200.0, 0.0));
}
