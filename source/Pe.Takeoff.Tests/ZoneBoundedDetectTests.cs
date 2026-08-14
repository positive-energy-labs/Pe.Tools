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

    private sealed record PromotionZoneReport(
        string Level,
        string Zone,
        double MinX,
        double MinY,
        double MaxX,
        double MaxY,
        string Tsv,
        string Ink,
        long RawMilliseconds,
        long PromotionMilliseconds,
        int OracleRooms,
        int RawRooms,
        int AcceptedRooms,
        int HeldRooms,
        int TinyMerged,
        double PartitionSqft,
        double AcceptedSqft,
        double HeldSqft,
        double VoidSqft,
        double ExcludedSqft,
        double HeldFraction,
        double VoidFraction,
        double InkBackedEdgeFraction,
        double ClosureErrorSqft,
        bool StrictlyEditable,
        bool Contained,
        IReadOnlyDictionary<string, int> Rejections);

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
        var promoted = TakeoffPromotion.PromoteZone(result, 30, snap.SeedInkDistance());
        Assert.Multiple(() => {
            Assert.That(result.Rooms, Is.Empty);
            Assert.That(result.Residues, Is.Empty);
            Assert.That(result.DomainSqft, Is.Zero);
            Assert.That(promoted.Result.Rooms, Is.Empty);
            Assert.That(promoted.Result.Residues, Is.Empty);
            Assert.That(promoted.Diagnostics.ClosureErrorSqft, Is.Zero);
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

    [Test]
    public void Prepared_level_detection_is_byte_identical_to_regular_replay()
    {
        var snap = TakeoffReplayTests.BuildSyntheticEstate();
        var options = ReplayOptions();
        var mask = RectZone("west", 3.5, 3.5, 24.5, 36.5).CellMask(snap.Field);
        string ordinary = snap.Replay(options, _ => { }, mask).ToTsv();

        var prepared = Detector.Prepare(
            snap.Field, snap.SeedInk, snap.LevelName, snap.LevelElevation, options, _ => { });
        string cached = prepared.Detect(mask, _ => { }).ToTsv();

        Assert.That(cached, Is.EqualTo(ordinary));
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

    private static string? FindInkBin(string token) =>
        new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .Select(dir => Path.Combine(dir, $"ink_{token}.bin"))
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
        var reports = new List<PromotionZoneReport>();
        string repoRoot = Path.GetFullPath(Path.Combine(RhvacEvalTests.FindFixtureDir(), "..", "..", ".."));
        string artifactDir = Path.Combine(repoRoot, ".artifacts", "takeoff-zone-promotion");
        if (Directory.Exists(artifactDir)) Directory.Delete(artifactDir, recursive: true);
        Directory.CreateDirectory(Path.Combine(artifactDir, "input"));
        Directory.CreateDirectory(Path.Combine(artifactDir, "zones"));
        int zonesRun = 0, zonesWithRooms = 0, abstained = 0;
        foreach (var (view, floor, bin) in levels)
        {
            var snap = DetectSnapshot.Load(bin!);
            var profile = TakeoffPolicy.InferLevelProfile(snap);
            var prepared = profile.NoHabitableDomain
                ? null
                : TakeoffPolicy.PrepareDetection(snap, profile, _ => { });
            var distanceToInk = snap.SeedInkDistance();
            var oracle = OracleCentroids(floor);
            string token = LevelMap.Single(item => item.View == view).BinToken;
            string? ink = FindInkBin(token);
            if (ink == null)
            {
                failures.Add($"{view}: missing ink_{token}.bin for registered promotion review");
                continue;
            }
            string copiedInk = Path.Combine(artifactDir, "input", $"ink_{token}.bin");
            string copiedReplay = Path.Combine(artifactDir, "input", $"replay_{token}.bin");
            File.Copy(ink, copiedInk, overwrite: true);
            File.Copy(bin!, copiedReplay, overwrite: true);
            foreach (var zone in ZonesFor(view))
            {
                var mask = zone.CellMask(snap.Field);
                var timer = System.Diagnostics.Stopwatch.StartNew();
                var result = prepared == null
                    ? TakeoffPolicy.Detect(snap, profile, _ => { }, zoneMask: mask)
                    : prepared.Detect(mask, _ => { });
                long rawMilliseconds = timer.ElapsedMilliseconds;
                timer.Restart();
                var promotion = TakeoffPromotion.PromoteZone(
                    result, new TakeoffOptions().MinimumPromotedRoomSqft, distanceToInk);
                long promotionMilliseconds = timer.ElapsedMilliseconds;
                zonesRun++;

                if (result.DomainSqft == 0)
                {
                    if (result.Rooms.Count > 0)
                        failures.Add($"{zone.Name}: rooms without domain");
                    abstained++;
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

                bool contained = promotion.Result.Rooms.All(room =>
                    room.Polygon.Concat(room.Holes.SelectMany(hole => hole))
                        .All(point => ContainsOrBoundary(zone.Loops, point[0], point[1])));
                if (!contained)
                    failures.Add($"{zone.Name}: promoted room geometry leaves declared zone");
                if (promotion.Diagnostics.ClosureErrorSqft > 1e-6)
                    failures.Add($"{zone.Name}: promoted accounting leaks " +
                                 $"{promotion.Diagnostics.ClosureErrorSqft:F6}sf");
                if (!promotion.Diagnostics.IsStrictlyEditable)
                    failures.Add($"{zone.Name}: accepted promotion is not strictly editable");
                if (oracleInside >= 2 && promotion.Result.Rooms.Count == 0
                    && promotion.Result.Residues.Count == 0
                    && promotion.Result.ExcludedResidueSqft == 0)
                    failures.Add($"{zone.Name}: promoted result vacuously hides {oracleInside} oracle rooms");

                string slug = $"{zonesRun:D2}_{Slug(zone.Name)}";
                string tsv = Path.Combine(artifactDir, "zones", $"rooms_{slug}.tsv");
                File.WriteAllText(tsv, promotion.Result.ToTsv());
                var points = zone.Loops.SelectMany(loop => loop).ToList();
                reports.Add(new PromotionZoneReport(
                    view,
                    zone.Name,
                    points.Min(point => point[0]),
                    points.Min(point => point[1]),
                    points.Max(point => point[0]),
                    points.Max(point => point[1]),
                    Path.GetRelativePath(artifactDir, tsv).Replace('\\', '/'),
                    Path.GetRelativePath(artifactDir, copiedInk).Replace('\\', '/'),
                    rawMilliseconds,
                    promotionMilliseconds,
                    oracleInside,
                    result.Rooms.Count,
                    promotion.Diagnostics.AcceptedRooms,
                    promotion.Diagnostics.HeldRooms,
                    promotion.Diagnostics.TinyMerged,
                    promotion.Diagnostics.PartitionSqft,
                    promotion.Diagnostics.AcceptedSqft,
                    promotion.Diagnostics.HeldSqft,
                    promotion.Diagnostics.VoidSqft,
                    promotion.Diagnostics.ExcludedSqft,
                    promotion.Diagnostics.HeldFraction,
                    promotion.Diagnostics.VoidFraction,
                    promotion.Diagnostics.InkBackedEdgeFraction,
                    promotion.Diagnostics.ClosureErrorSqft,
                    promotion.Diagnostics.IsStrictlyEditable,
                    contained,
                    promotion.Diagnostics.Rejections));
                TestContext.Out.WriteLine(
                    $"{zone.Name}: raw={result.Rooms.Count} accepted={promotion.Diagnostics.AcceptedRooms} " +
                    $"held={promotion.Diagnostics.HeldRooms} ink={promotion.Diagnostics.InkBackedEdgeFraction:P0} " +
                    $"closure={promotion.Diagnostics.ClosureErrorSqft:F3}sf " +
                    $"time={rawMilliseconds}+{promotionMilliseconds}ms oracle={oracleInside}");
            }
        }
        File.WriteAllText(Path.Combine(artifactDir, "report.json"),
            JsonConvert.SerializeObject(new {
                SchemaVersion = 1,
                GeneratedUtc = DateTimeOffset.UtcNow,
                Zones = reports,
                RejectionHistogram = reports.SelectMany(report => report.Rejections)
                    .GroupBy(item => item.Key, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.Sum(item => item.Value),
                        StringComparer.Ordinal),
            }, Formatting.Indented) + Environment.NewLine);
        TestContext.Out.WriteLine(
            $"zones={zonesRun} withRooms={zonesWithRooms} abstained={abstained} " +
            $"artifact={artifactDir}");
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
        var raw = snap.ReplayInferred(_ => { }, zoneMask: mask);
        var profile = TakeoffPolicy.InferLevelProfile(snap);
        var cached = TakeoffPolicy.PrepareDetection(snap, profile, _ => { })
            .Detect(mask, _ => { });
        var distanceToInk = snap.SeedInkDistance();
        var first = TakeoffPromotion.PromoteZone(
            cached, new TakeoffOptions().MinimumPromotedRoomSqft, distanceToInk);
        var second = TakeoffPromotion.PromoteZone(
            cached, new TakeoffOptions().MinimumPromotedRoomSqft, distanceToInk);
        Assert.Multiple(() => {
            Assert.That(cached.ToTsv(), Is.EqualTo(raw.ToTsv()),
                "prepared level evidence must preserve real replay output byte-for-byte");
            Assert.That(second.Result.ToTsv(), Is.EqualTo(first.Result.ToTsv()));
            Assert.That(JsonConvert.SerializeObject(second.Diagnostics),
                Is.EqualTo(JsonConvert.SerializeObject(first.Diagnostics)));
        });
    }

    private static string Slug(string value) => new(value.Select(character =>
        char.IsLetterOrDigit(character) ? character : '_').ToArray());

    private static bool ContainsOrBoundary(List<List<double[]>> loops, double x, double y)
    {
        if (ZoneScope.ContainsEvenOdd(loops, x, y)) return true;
        const double epsilon = 1e-7;
        foreach (var loop in loops)
        for (int index = 0; index < loop.Count; index++)
        {
            var from = loop[index];
            var to = loop[(index + 1) % loop.Count];
            double dx = to[0] - from[0], dy = to[1] - from[1];
            double lengthSquared = dx * dx + dy * dy;
            double t = lengthSquared <= epsilon ? 0
                : Math.Max(0, Math.Min(1, ((x - from[0]) * dx + (y - from[1]) * dy) / lengthSquared));
            double px = from[0] + t * dx, py = from[1] + t * dy;
            if ((x - px) * (x - px) + (y - py) * (y - py) <= epsilon * epsilon) return true;
        }
        return false;
    }
}
