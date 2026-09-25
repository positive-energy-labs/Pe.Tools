using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     The rerun contract on Duryee Level 1's hand-drawn zones: run 1 on the bare zone; lock run 1's accepted rooms as a
///     person would by materialising them; run 2 returns each locked room whole and every other room as run 1 drew it.
/// </summary>
public sealed class RailsRerunTests {
    private static string DuryeeInput => Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-level-input.json");
    private static string DuryeeZones => Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-locked.json");
    private static readonly Handle Stub = new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);

    private static IEnumerable<TestCaseData> Zones() {
        foreach (var id in new[] { 6692266L, 6693266L, 6693828L, 6694146L }) yield return new TestCaseData(id).SetName($"duryee-{id}");
    }

    private static PartitionAnswer Solve1(PartitionInput input) =>
        Solve.RunRails(input, (_, _) => new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched,
            new ProbeHit(Stub, 0.0, input.LevelZ), new ProbeHit(Stub, 9.0, input.LevelZ + 9.0), 200.0, 0.0));

    private static PartitionInput Load(long id) {
        var level = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(DuryeeInput))!;
        var zone = JArray.Parse(File.ReadAllText(DuryeeZones)).Single(z => (long)z["ElementId"]! == id);
        return level with { ZoneLoops = [zone["Outer"]!.SelectMany(p => new[] { (double)p[0]!, (double)p[1]! }).ToArray()], Proposals = [] };
    }

    private static string Key(Room r) => $"{r.Disposition} {r.Reason} {r.AreaSqft:0.000} @({r.LabelX:0.00},{r.LabelY:0.00})";

    [TestCaseSource(nameof(Zones))]
    public void Capture_order_does_not_change_the_rooms(long id) {
        var input = Load(id);
        var first = Solve1(input).Rooms.Select(Key).Order().ToList();
        var diffs = new List<string>();
        foreach (var (tag, other) in new[] {
            ("knee reversed", input with { Knee = input.Knee with { Elements = input.Knee.Elements.Reverse().ToList() } }),
            ("header reversed", input with { Header = input.Header with { Elements = input.Header.Elements.Reverse().ToList() } }),
            ("pieces reversed", input with { Knee = input.Knee with { Elements = input.Knee.Elements.Select(e => e with { Pieces = e.Pieces.Reverse().ToList() }).ToList() } }),
        }) {
            var got = Solve1(other).Rooms.Select(Key).Order().ToList();
            diffs.AddRange(first.Except(got).Select(k => $"{tag}: lost {k}"));
            diffs.AddRange(got.Except(first).Select(k => $"{tag}: new  {k}"));
        }
        foreach (var d in diffs) TestContext.Out.WriteLine(d);
        Assert.That(diffs, Is.Empty);
    }

    [TestCaseSource(nameof(Zones))]
    public void Rerun_with_accepted_rooms_locked_redraws_the_rest(long id) {
        var input = Load(id);
        var first = Solve1(input);
        Assert.That(Solve1(input).Rooms.Select(Key), Is.EqualTo(first.Rooms.Select(Key)), "identical rerun");
        var accepted = first.Rooms.Where(r => r.Disposition == Disposition.Accepted).ToList();
        var diffs = new List<string>();
        foreach (var lockSet in accepted.Select(r => new[] { r }).Append(accepted.ToArray())) {
            var proposals = lockSet.Select(r => new RoomProposal(RoomProposal.LockedPrefix + r.Index, $"R{r.Index}", "", [r.Loop, .. r.Holes])).ToList();
            var second = Solve1(input with { Proposals = proposals });
            var locked = lockSet.Select(r => r.Index).ToHashSet();
            var want = first.Rooms.Where(r => !locked.Contains(r.Index)).Select(Key).Order().ToList();
            var got = second.Rooms.Where(r => r.Proposal is null).Select(Key).Order().ToList();
            var tag = lockSet.Length == 1 ? $"lock {Key(lockSet[0])}" : "lock all accepted";
            foreach (var r in second.Rooms.Where(r => r.Proposal is not null)) {
                var src = first.Rooms[int.Parse(r.Proposal!.SourceKey[RoomProposal.LockedPrefix.Length..])];
                if (r.Disposition != Disposition.Accepted || Math.Abs(r.AreaSqft - src.AreaSqft) > 1e-3)
                    diffs.Add($"{tag}: locked returned {Key(r)}, was {Key(src)}");
            }
            diffs.AddRange(want.Except(got).Select(k => $"{tag}: lost {k}"));
            diffs.AddRange(got.Except(want).Select(k => $"{tag}: new  {k}"));
        }
        foreach (var d in diffs) TestContext.Out.WriteLine(d);
        Assert.That(diffs, Is.Empty);
    }

    // rooms.merge (rooms LEDGER 2026-09-25): a person merges two adjacent accepted rooms; the rerun locks their union as
    // one proposal. The union comes back whole and every other room comes back as run 1 drew it.
    [TestCaseSource(nameof(Zones))]
    public void Rerun_with_a_merged_pair_locked_redraws_the_rest(long id) {
        var input = Load(id);
        var first = Solve1(input);
        var accepted = first.Rooms.Where(r => r.Disposition == Disposition.Accepted).ToList();
        var pair = accepted.SelectMany((a, i) => accepted.Skip(i + 1).Select(b => (A: a, B: b)))
            .Select(p => (p.A, p.B, Union: NetTopologySuite.Operation.OverlayNG.OverlayNGRobust.Union(
                Solve.GeometryOf([p.A.Loop, .. p.A.Holes]).Union(Solve.GeometryOf([p.B.Loop, .. p.B.Holes])))))
            .FirstOrDefault(p => p.Union is NetTopologySuite.Geometries.Polygon);
        Assume.That(pair.Union, Is.Not.Null, $"duryee-{id} has no two accepted rooms that touch");
        var union = (NetTopologySuite.Geometries.Polygon)pair.Union;
        double[] Flat(NetTopologySuite.Geometries.LineString ring) =>
            ring.Coordinates.Take(ring.NumPoints - 1).SelectMany(c => new[] { c.X, c.Y }).ToArray();
        var merged = new RoomProposal(RoomProposal.LockedPrefix + "merged", "merged", "",
            [Flat(union.Shell), .. union.Holes.Select(Flat)]);
        var second = Solve1(input with { Proposals = [merged] });
        var want = first.Rooms.Where(r => r.Index != pair.A.Index && r.Index != pair.B.Index).Select(Key).Order().ToList();
        var got = second.Rooms.Where(r => r.Proposal is null).Select(Key).Order().ToList();
        var back = second.Rooms.Where(r => r.Proposal?.SourceKey == merged.SourceKey).ToList();
        Assert.Multiple(() => {
            Assert.That(back, Has.Count.EqualTo(1), "the merged pair comes back as one room");
            Assert.That(back.Single().Disposition, Is.EqualTo(Disposition.Accepted));
            Assert.That(back.Single().AreaSqft, Is.EqualTo(pair.A.AreaSqft + pair.B.AreaSqft).Within(1e-3));
            Assert.That(got.Except(want), Is.Empty, "no neighbour is new");
            Assert.That(want.Except(got), Is.Empty, "no neighbour is lost");
        });
    }
}
