using Newtonsoft.Json;

using NUnit.Framework;

using Pe.Revit.Takeoff;

namespace Pe.Takeoff.Tests;

// Zone-bounded partition: the detector's domain is a designer-drawn Zoning Region, never the
// level. Synthetic tests prove the mask mechanics in CI; the project-a tests upgrade to the real
// captured state plus the 45 real designer zones (zones-mech.json) automatically once a live run
// has produced replay_<level>.bin. Gates are conservation and identity laws, no oracle scores:
//   containment — no room or residue geometry outside the declared zone
//   closure     — rooms + residues + excluded == domain + claimed wall band, exactly
//   abstention  — a zone with no habitable domain yields nothing, without error
//   non-vacuous — a zone holding oracle rooms never passes by rejecting everything
//   determinism — same snapshot + same zone => byte-identical TSV (the anti-dice law)
public sealed class ZoneBoundedDetectTests
{
    // ---- synthetic: mask mechanics ----

    private static TakeoffOptions ReplayOptions() => new() { CellFt = 0.5, SealWallRunGaps = true };

    private static ZoneScope RectZone(string name, double x0, double y0, double x1, double y1) => new() {
        Name = name,
        Loops = { new List<double[]> { new[] { x0, y0 }, new[] { x1, y0 }, new[] { x1, y1 }, new[] { x0, y1 } } },
    };

    private static double ClosureError(TakeoffResult result) =>
        Math.Abs(result.Rooms.Sum(r => r.RawSqft) + result.Residues.Sum(r => r.RawSqft)
                 + result.ExcludedResidueSqft - (result.DomainSqft + result.ClaimedWallSqft));

    [Test]
    public void Zone_mask_bounds_partition_to_west_block()
    {
        var snap = TakeoffReplayTests.BuildSyntheticEstate();
        var whole = snap.Replay(ReplayOptions(), _ => { });
        // West-block zone: envelope west wall through the divider centerline (x=24.5 ft).
        var zone = RectZone("west", 3.5, 3.5, 24.5, 36.5);
        var masked = snap.Replay(ReplayOptions(), _ => { }, zone.CellMask(snap.Field));

        Assert.Multiple(() => {
            Assert.That(whole.Rooms, Has.Count.GreaterThanOrEqualTo(3), "unmasked estate sanity");
            Assert.That(masked.Rooms, Has.Count.EqualTo(2), "west block holds exactly rooms A and B");
            foreach (var room in masked.Rooms)
            foreach (var v in room.Polygon)
            {
                Assert.That(v[0], Is.InRange(3.5 - 1e-9, 24.5 + 1e-9), $"{room.Id} leaks in x");
                Assert.That(v[1], Is.InRange(3.5 - 1e-9, 36.5 + 1e-9), $"{room.Id} leaks in y");
            }
            Assert.That(ClosureError(masked), Is.LessThan(1e-6), "accounting closes exactly");
        });
    }

    [Test]
    public void Empty_zone_abstains_without_rooms_or_error()
    {
        var snap = TakeoffReplayTests.BuildSyntheticEstate();
        var zone = RectZone("exterior", 0, 0, 3.0, 3.0); // outside the envelope entirely
        var result = snap.Replay(ReplayOptions(), _ => { }, zone.CellMask(snap.Field));
        Assert.Multiple(() => {
            Assert.That(result.Rooms, Is.Empty);
            Assert.That(result.Residues, Is.Empty);
            Assert.That(result.DomainSqft, Is.Zero);
        });
    }

    [Test]
    public void Zone_masked_replay_is_deterministic()
    {
        var snap = TakeoffReplayTests.BuildSyntheticEstate();
        var mask = RectZone("west", 3.5, 3.5, 24.5, 36.5).CellMask(snap.Field);
        string first = snap.Replay(ReplayOptions(), _ => { }, mask).ToTsv();
        string second = snap.Replay(ReplayOptions(), _ => { }, mask).ToTsv();
        Assert.That(second, Is.EqualTo(first));
    }

    // ---- projectA: real capture x real designer zones ----

    private sealed record ZoneRecord(string View, string TypeName, string? Comments, double[][][] Loops);

    // zoning view name fragment -> (replay bin token, oracle floor index)
    private static readonly (string View, string BinToken, int Floor)[] LevelMap = {
        ("Lower Level", "Level_0_Lower_Level", 0),
        ("Main Level", "Level_1_Main_Level", 1),
        ("Upper Level", "Level_2_Upper_Level", 2),
        ("Attic Level", "Level_3_Attic", 3),
    };

    private static string? FindReplayBin(string token) =>
        new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .Select(dir => Path.Combine(dir, $"replay_{token}.bin"))
            .FirstOrDefault(File.Exists);

    private static List<ZoneScope> ZonesFor(string viewFragment)
    {
        string path = Path.Combine(RhvacEvalTests.FindFixtureDir(), "zones-mech.json");
        var records = JsonConvert.DeserializeObject<List<ZoneRecord>>(File.ReadAllText(path))
                      ?? throw new InvalidOperationException($"unreadable {path}");
        return records
            .Where(z => z.View.Contains(viewFragment, StringComparison.Ordinal))
            .Select((z, i) => new ZoneScope {
                Name = $"{viewFragment}#{i:D2}",
                Loops = z.Loops
                    .Select(loop => loop.Select(p => new[] { p[0], p[1] }).ToList())
                    .ToList(),
            })
            .ToList();
    }

    private static List<(double X, double Y)> OracleCentroids(int floor)
    {
        string path = Path.Combine(RhvacEvalTests.FindFixtureDir(), "oracle-geometry.json");
        var doc = JsonConvert.DeserializeObject<OracleGeometry>(File.ReadAllText(path))
                  ?? throw new InvalidOperationException($"unreadable {path}");
        return doc.Rooms.Values
            .Where(r => r.Floor == floor && r.PolygonModelFt is { Length: >= 3 })
            .Select(r => (
                r.PolygonModelFt!.Average(p => p[0]),
                r.PolygonModelFt!.Average(p => p[1])))
            .ToList();
    }

    private sealed record OracleGeometry(Dictionary<string, OracleRoom> Rooms);

    private sealed record OracleRoom(string Name, int Floor, double[][]? PolygonModelFt);

    [Test]
    public void ProjectA_zones_partition_within_declared_scope()
    {
        var levels = LevelMap
            .Select(m => (m.View, m.Floor, Bin: FindReplayBin(m.BinToken)))
            .Where(m => m.Bin != null)
            .ToList();
        if (levels.Count == 0)
            Assert.Ignore("no replay_*.bin captured yet; run eval/rhvac/run-takeoff.py once live");

        var failures = new List<string>();
        int zonesRun = 0, zonesWithRooms = 0, abstained = 0;
        foreach (var (view, floor, bin) in levels)
        {
            var snap = DetectSnapshot.Load(bin!);
            var oracle = OracleCentroids(floor);
            foreach (var zone in ZonesFor(view))
            {
                var mask = zone.CellMask(snap.Field);
                var result = snap.ReplayInferred(_ => { }, zoneMask: mask);
                zonesRun++;

                if (result.DomainSqft == 0)
                {
                    if (result.Rooms.Count > 0)
                        failures.Add($"{zone.Name}: rooms without domain");
                    abstained++;
                    continue;
                }
                if (result.Rooms.Count > 0) zonesWithRooms++;

                // containment: every emitted vertex inside the zone loops within one cell — a
                // vertex sits on a cell corner, up to half a cell diagonally outside the last
                // masked cell CENTER, so probe a ring of offsets including diagonals.
                double tol = snap.Field.CellFt;
                foreach (var poly in result.Rooms.Select(r => (Id: r.Id, r.Polygon))
                             .Concat(result.Residues.Select(r => (Id: r.Id, r.Polygon))))
                foreach (var v in poly.Polygon)
                {
                    bool inside = false;
                    for (int dy = -1; dy <= 1 && !inside; dy++)
                    for (int dx = -1; dx <= 1 && !inside; dx++)
                        inside = ZoneScope.ContainsEvenOdd(zone.Loops, v[0] + dx * tol, v[1] + dy * tol);
                    if (inside) continue;
                    failures.Add($"{zone.Name}: {poly.Id} vertex ({v[0]:F2},{v[1]:F2}) outside zone");
                    break;
                }

                double closure = ClosureError(result);
                if (closure > 1e-6)
                    failures.Add($"{zone.Name}: accounting leaks {closure:F2}sf");

                // Vacuous pass = nothing visible at all. Rooms held as residue is honest
                // abstention, not a pass — the law demands visibility, not success.
                int oracleInside = oracle.Count(c => ZoneScope.ContainsEvenOdd(zone.Loops, c.X, c.Y));
                if (oracleInside >= 2 && result.Rooms.Count == 0 && result.Residues.Count == 0
                    && result.ExcludedResidueSqft == 0)
                    failures.Add($"{zone.Name}: vacuous pass — {oracleInside} oracle rooms, nothing emitted");

                TestContext.Out.WriteLine(
                    $"{zone.Name}: rooms={result.Rooms.Count} residues={result.Residues.Count} " +
                    $"domain={result.DomainSqft:F0}sf claimed={result.ClaimedWallSqft:F0}sf oracle={oracleInside}");
            }
        }
        TestContext.Out.WriteLine(
            $"zones={zonesRun} withRooms={zonesWithRooms} abstained={abstained}");
        Assert.That(failures, Is.Empty, string.Join("\n", failures));
    }

    [Test]
    public void ProjectA_zone_rerun_is_deterministic()
    {
        string? bin = FindReplayBin("Level_1_Main_Level");
        if (bin == null)
            Assert.Ignore("no replay_*.bin captured yet; run eval/rhvac/run-takeoff.py once live");
        var snap = DetectSnapshot.Load(bin);
        var zone = ZonesFor("Main Level").First();
        var mask = zone.CellMask(snap.Field);
        string first = snap.ReplayInferred(_ => { }, zoneMask: mask).ToTsv();
        string second = snap.ReplayInferred(_ => { }, zoneMask: mask).ToTsv();
        Assert.That(second, Is.EqualTo(first));
    }
}
