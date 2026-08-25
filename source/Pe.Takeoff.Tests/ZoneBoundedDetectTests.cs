using System.Collections.Concurrent;
using System.Globalization;
using System.Text;

using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

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
        IReadOnlyList<List<double[]>> ZoneLoops,
        string Tsv,
        string Ink,
        string Seals,
        string Close,
        long RawMilliseconds,
        long PromotionMilliseconds,
        int OracleRooms,
        int RawRooms,
        int SharedNetworkStrictRooms,
        int AcceptedRooms,
        int HeldRooms,
        int TinyMerged,
        double PartitionSqft,
        double AcceptedSqft,
        double HeldSqft,
        double VoidSqft,
        double ExcludedSqft,
        double ZoneSqft,
        double HeldFraction,
        double VoidFraction,
        double InkBackedEdgeFraction,
        double ClosureErrorSqft,
        double GapSqft,
        double OverlapSqft,
        double OutsideZoneSqft,
        bool StrictlyEditable,
        bool Contained,
        int SharedEdgePairs,
        int LostSharedEdgePairs,
        IReadOnlyDictionary<string, int> Rejections,
        IReadOnlyDictionary<string, string> RejectionDetails,
        // report.json v2 contract fields, camelCase by name because a sibling analysis tool reads
        // them literally. Everything above predates the contract and keeps its historical casing.
        [property: JsonProperty("census")] object Census,
        [property: JsonProperty("triage")] object Triage,
        [property: JsonProperty("whiteoutCells")] int WhiteoutCells,
        [property: JsonProperty("domainReflood")] object? DomainReflood,
        [property: JsonProperty("partition")] object Partition,
        [property: JsonProperty("adaptedKnobs")] IReadOnlyDictionary<string, string> AdaptedKnobs,
        // Closure accounting: how much of this zone's obstruction the sealers invented rather than
        // read off the drawing. closureSqft is the door/window closure area drawn on the panel;
        // the closure block splits it and reports the generic morphological close separately.
        [property: JsonProperty("closureSqft")] double ClosureSqft,
        [property: JsonProperty("closure")] object Closure,
        // report.json v4: stable cross-run zone identity (SHIMS.md #2). Zone names are ordinals
        // assigned during zoning; this key is what A/B pairing may trust.
        [property: JsonProperty("zoneKey")] string ZoneKey);

    /// <summary>
    /// Stable cross-run zone identity: sha256 over the level name plus the zone's bbox quantized
    /// to 0.5 ft, first 12 hex chars. Nothing ordinal goes in, so the key survives re-zoning
    /// REORDERINGS and sub-half-foot jitter; it changes exactly when the zone's geography
    /// actually moves — which is the event A/B pairing must refuse to paper over.
    /// </summary>
    private static string ZoneKey(string view, double minX, double minY, double maxX, double maxY)
    {
        static double Quantized(double value) => Math.Round(value * 2, MidpointRounding.AwayFromZero) / 2;
        string payload = FormattableString.Invariant(
            $"{view}|{Quantized(minX):F1}|{Quantized(minY):F1}|{Quantized(maxX):F1}|{Quantized(maxY):F1}");
        byte[] hash = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        return Convert.ToHexString(hash)[..12].ToLowerInvariant();
    }

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
        var promoted = TakeoffPromotion.PromoteZone(
            result, zone, ReplayOptions(), snap.SeedInkDistance());
        Assert.Multiple(() => {
            Assert.That(result.Rooms, Is.Empty);
            Assert.That(result.Residues, Is.Empty);
            Assert.That(result.DomainSqft, Is.Zero);
            Assert.That(promoted.Result.Rooms, Is.Empty);
            Assert.That(promoted.Result.Residues, Has.Count.EqualTo(1));
            Assert.That(promoted.Result.Residues.Single().Reason, Is.EqualTo(ResidueReason.Excluded));
            Assert.That(promoted.Result.Residues.Single().RawSqft, Is.EqualTo(9).Within(1e-9));
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
        var zone = RectZone("west", 3.5, 3.5, 24.5, 36.5);
        var mask = zone.CellMask(snap.Field);
        string ordinary = snap.Replay(options, _ => { }, mask).ToTsv();

        var prepared = Detector.Prepare(
            snap.Field, snap.SeedInk, snap.LevelName, snap.LevelElevation, options, _ => { });
        string cached = prepared.Detect(mask, _ => { }).ToTsv();
        string cropped = prepared.Detect(zone, _ => { }).ToTsv();

        Assert.Multiple(() => {
            Assert.That(cached, Is.EqualTo(ordinary));
            Assert.That(cropped, Is.EqualTo(cached),
                "padded zone crop must preserve the full-grid partition exactly");
        });
    }

    [Test]
    public void Ink_hygiene_is_inert_when_disarmed_and_still_closes_when_armed()
    {
        var snap = TakeoffReplayTests.BuildSyntheticEstate();
        var zone = RectZone("west", 3.5, 3.5, 24.5, 36.5);
        var quiet = Detector.Prepare(
            snap.Field, snap.SeedInk, snap.LevelName, snap.LevelElevation, ReplayOptions(), _ => { });
        string baseline = quiet.Detect(zone, _ => { }, out int quietCells).ToTsv();

        var options = ReplayOptions();
        options.InkClusterWhiteoutCells = 100;
        var armedPrepare = Detector.Prepare(
            snap.Field, snap.SeedInk, snap.LevelName, snap.LevelElevation, options, _ => { });
        var armed = armedPrepare.Detect(zone, _ => { }, out int armedCells);

        Assert.Multiple(() => {
            Assert.That(quietCells, Is.Zero, "a disarmed knob never edits the raster");
            Assert.That(quiet.Detect(zone, _ => { }, out _).ToTsv(), Is.EqualTo(baseline));
            Assert.That(armedCells, Is.GreaterThanOrEqualTo(0));
            Assert.That(ClosureError(armed), Is.LessThan(1e-6),
                "hygiene may delete ink but never accounting");
            Assert.That(armedPrepare.Detect(zone, _ => { }, out _).ToTsv(), Is.EqualTo(armed.ToTsv()),
                "the cleaned raster stays deterministic");
        });
    }

    [Test]
    public void Zone_domain_diagnostics_explain_crop_reflood_loss()
    {
        const int width = 20, height = 20;
        var field = new Heightfield {
            W = width, H = height, CellFt = 1,
            FloorZ = new float[width * height],
            CeilZ = Enumerable.Repeat(9f, width * height).ToArray(),
        };
        var ink = new bool[width * height];
        for (int x = 1; x < width - 1; x++)
        {
            ink[1 * width + x] = true;
            ink[(height - 2) * width + x] = true;
        }
        for (int y = 1; y < height - 1; y++)
        {
            ink[y * width + 1] = true;
            ink[y * width + width - 2] = true;
        }
        ink[10 * width + 10] = true;
        var options = new TakeoffOptions {
            CellFt = 1,
            GapSealFt = 0.1,
            InkClusterWhiteoutCells = 2,
            MinSqft = 1,
            MinFeatureWidthFt = 1,
            WallClaimFt = 0,
        };
        var prepared = Detector.Prepare(field, ink, "Diagnostic", 0, options, _ => { });
        var ordinary = prepared.Detect(RectZone("inside", 5, 5, 15, 15), _ => { });

        var result = prepared.Detect(
            RectZone("inside", 5, 5, 15, 15), _ => { },
            out int whiteoutCells, out ZoneDomainDiagnostics diagnostics);

        Assert.Multiple(() => {
            Assert.That(whiteoutCells, Is.EqualTo(1));
            Assert.That(diagnostics.PreparedDomainSqft, Is.EqualTo(100));
            Assert.That(diagnostics.CropRecomputedDomainSqft, Is.Zero);
            Assert.That(diagnostics.ExclusionProvenance, Is.EqualTo("crop-reflood"));
            Assert.That(diagnostics.LostComponents, Has.Count.EqualTo(1));
            Assert.That(diagnostics.LostComponents.Single().AreaSqft, Is.EqualTo(100));
            Assert.That(diagnostics.LostComponents.Single().Polygons, Has.Count.EqualTo(1));
            Assert.That(diagnostics.HeldCandidates, Has.Count.EqualTo(1));
            Assert.That(diagnostics.HeldCandidates.Single().AreaSqft, Is.EqualTo(100));
            Assert.That(result.DomainSqft, Is.EqualTo(diagnostics.CropRecomputedDomainSqft),
                "diagnostics must observe, not alter, the effective partition domain");
            Assert.That(result.ToTsv(), Is.EqualTo(ordinary.ToTsv()),
                "review candidates must not change an incumbent disposition or polygon");
        });
    }

    [Test]
    public void Domain_reflood_requires_received_ink_for_nonconvex_review_geometry()
    {
        var rectangle = new ZoneDomainLossComponent(120, [
            [new[] { 0d, 0d }, new[] { 12d, 0d }, new[] { 12d, 10d }, new[] { 0d, 10d }],
        ]);
        var concave = new ZoneDomainLossComponent(64, [
            [new[] { 0d, 20d }, new[] { 10d, 20d }, new[] { 10d, 24d },
             new[] { 4d, 24d }, new[] { 4d, 30d }, new[] { 0d, 30d }],
        ]);
        var scalloped = new ZoneDomainLossComponent(110, [
            [new[] { 20d, 0d }, new[] { 32d, 0d }, new[] { 32d, 10d },
             new[] { 31.5, 10d }, new[] { 31.5, 4d }, new[] { 31d, 4d },
             new[] { 31d, 10d }, new[] { 30.5, 10d }, new[] { 30.5, 4d },
             new[] { 30d, 4d }, new[] { 30d, 10d }, new[] { 29.5, 10d },
             new[] { 29.5, 4d }, new[] { 29d, 4d }, new[] { 29d, 10d },
             new[] { 28.5, 10d }, new[] { 28.5, 4d }, new[] { 28d, 4d },
             new[] { 28d, 10d }, new[] { 27.5, 10d }, new[] { 27.5, 4d },
             new[] { 27d, 4d }, new[] { 27d, 10d }, new[] { 20d, 10d }],
        ]);

        var unsupported = PreparedTakeoffDetection.DomainRefloodHeldCandidates(
            [rectangle, concave, scalloped], "Diagnostic", 0,
            new TakeoffOptions { MinimumPromotedRoomSqft = 30 });
        var supported = PreparedTakeoffDetection.DomainRefloodHeldCandidates(
            [rectangle, concave, scalloped], "Diagnostic", 0,
            new TakeoffOptions { MinimumPromotedRoomSqft = 30 },
            distanceToReceivedInk: (x, _) => x < 15 ? 0 : double.PositiveInfinity);

        Assert.Multiple(() => {
            Assert.That(unsupported.Select(candidate => candidate.Id),
                Is.EqualTo(new[] { "CROP-REFLOOD-HELD:1" }));
            Assert.That(supported.Select(candidate => candidate.Id),
                Is.EqualTo(new[] { "CROP-REFLOOD-HELD:1", "CROP-REFLOOD-HELD:2" }));
        });
    }

    [Test]
    public void Domain_reflood_review_geometry_subtracts_accepted_or_drops_a_split()
    {
        var candidates = new[] {
            new ZoneDomainHeldCandidate("clip", 100,
                [[new[] { 0d, 0d }, new[] { 10d, 0d }, new[] { 10d, 10d }, new[] { 0d, 10d }]]),
            new ZoneDomainHeldCandidate("split", 100,
                [[new[] { 0d, 20d }, new[] { 10d, 20d }, new[] { 10d, 30d }, new[] { 0d, 30d }]]),
        };
        var accepted = new TakeoffResult {
            LevelName = "Diagnostic",
            Rooms = {
                new RoomResult { Id = "edge", RawSqft = 20,
                    Polygon = [new[] { 8d, 0d }, new[] { 10d, 0d },
                        new[] { 10d, 10d }, new[] { 8d, 10d }] },
                new RoomResult { Id = "stripe", RawSqft = 20,
                    Polygon = [new[] { 4d, 20d }, new[] { 6d, 20d },
                        new[] { 6d, 30d }, new[] { 4d, 30d }] },
            },
        };

        var normalized = TakeoffPromotion.NormalizeDomainRefloodHeldCandidates(
            candidates, accepted);

        Assert.Multiple(() => {
            Assert.That(normalized.Select(candidate => candidate.Id), Is.EqualTo(new[] { "clip" }));
            Assert.That(normalized.Single().AreaSqft, Is.EqualTo(80).Within(1e-6));
        });
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

    private static string? FindPlanReference(string token, string extension) =>
        new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .Select(dir => Path.Combine(dir, $"plan_{token}.{extension}"))
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
            .Select((m, index) => (Index: index, m.View, m.Floor, Bin: FindReplayBin(m.BinToken)))
            .Where(m => m.Bin != null)
            .ToList();
        if (levels.Count == 0)
            Assert.Ignore("no replay_*.bin captured yet; run eval/rhvac/run-takeoff.py once live");

        var failures = new ConcurrentBag<string>();
        var reports = new ConcurrentBag<PromotionZoneReport>();
        string repoRoot = Path.GetFullPath(Path.Combine(RhvacEvalTests.FindFixtureDir(), "..", "..", ".."));
        string artifactDir = Path.Combine(repoRoot, ".artifacts", "takeoff-zone-promotion");
        if (Directory.Exists(artifactDir)) Directory.Delete(artifactDir, recursive: true);
        Directory.CreateDirectory(Path.Combine(artifactDir, "input"));
        Directory.CreateDirectory(Path.Combine(artifactDir, "zones"));
        string rawZonesDir = Path.Combine(artifactDir, "raw-zones");
        Directory.CreateDirectory(rawZonesDir);
        string? zoneFilter = Environment.GetEnvironmentVariable("PE_TAKEOFF_ZONE");
        int zonesRun = 0, zonesWithRooms = 0, abstained = 0;
        var effectiveOptions = new ConcurrentDictionary<string, TakeoffOptions>(StringComparer.Ordinal);
        Parallel.ForEach(levels, new ParallelOptions {
            MaxDegreeOfParallelism = Math.Min(4, levels.Count),
        }, level =>
        {
            var (levelIndex, view, floor, bin) = level;
            var snap = DetectSnapshot.Load(bin!);
            var profile = TakeoffPolicy.InferLevelProfile(snap);
            ApplyKnobOverrides(profile.Options);
            var prepared = profile.NoHabitableDomain
                ? null
                : TakeoffPolicy.PrepareDetection(snap, profile, _ => { });
            // Door-head seals are model-derived evidence, so the promotion oracle counts them;
            // wall-run and gap-close plugs stay heuristic and do not back a room's boundary.
            var distanceToInk = snap.EvidenceInkDistance(profile);
            // Wall-ink oracle (seed ink only): the absorb stage's separator judgment asks "is this
            // boundary a WALL", and a door-head is an opening, not a wall.
            var distanceToWallInk = snap.SeedInkDistance();
            var oracle = OracleCentroids(floor);
            effectiveOptions[view] = profile.Options;
            string token = LevelMap.Single(item => item.View == view).BinToken;
            string? ink = FindInkBin(token);
            string? planImage = FindPlanReference(token, "png");
            string? planManifest = FindPlanReference(token, "json");
            if (ink == null)
            {
                failures.Add($"{view}: missing ink_{token}.bin for registered promotion review");
                return;
            }
            if ((planImage == null) != (planManifest == null))
            {
                failures.Add($"{view}: incomplete plan_{token}.png/json review reference");
                return;
            }
            string copiedInk = Path.Combine(artifactDir, "input", $"ink_{token}.bin");
            string copiedReplay = Path.Combine(artifactDir, "input", $"replay_{token}.bin");
            File.Copy(ink!, copiedInk, overwrite: true);
            File.Copy(bin!, copiedReplay, overwrite: true);
            if (planImage != null)
            {
                File.Copy(planImage, Path.Combine(artifactDir, "input", $"plan_{token}.png"),
                    overwrite: true);
                File.Copy(planManifest!, Path.Combine(artifactDir, "input", $"plan_{token}.json"),
                    overwrite: true);
            }
            // Sealed cells are obstruction the drawing never drew. Persisting them next to the raw
            // ink is what makes a closure arguable in review instead of an invisible policy effect.
            var sealClasses = TakeoffPolicy.SealClasses(snap, profile);
            var doorClosure = new bool[sealClasses.Length];
            var gapClose = new bool[sealClasses.Length];
            for (int i = 0; i < sealClasses.Length; i++)
            {
                doorClosure[i] = sealClasses[i] is Detector.SealDoorHead
                    or Detector.SealDoorHeadOversize or Detector.SealWallRunGap;
                gapClose[i] = sealClasses[i] == Detector.SealGapClose;
            }
            string sealBin = Path.Combine(artifactDir, "input", $"seals_{token}.bin");
            string closeBin = Path.Combine(artifactDir, "input", $"close_{token}.bin");
            InkSupport.Save(sealBin, snap.Field.W, snap.Field.H,
                snap.Field.MinX, snap.Field.MinY, snap.Field.CellFt, doorClosure);
            InkSupport.Save(closeBin, snap.Field.W, snap.Field.H,
                snap.Field.MinX, snap.Field.MinY, snap.Field.CellFt, gapClose);
            // The merged seals bin is lossy (door-head + oversize + wall-run collapse to one bit);
            // the INKC sidecar keeps per-cell attribution so review can split door/run honestly.
            // No report field: readers derive classes_<token>.bin from the zone's Seals path, so
            // the report schema (and older artifacts) stay valid.
            InkSupport.SaveClasses(
                Path.Combine(artifactDir, "input", $"classes_{token}.bin"),
                snap.Field.W, snap.Field.H,
                snap.Field.MinX, snap.Field.MinY, snap.Field.CellFt, sealClasses);
            double cellSqft = snap.Field.CellFt * snap.Field.CellFt;
            TestContext.Out.WriteLine($"{view}: profile {profile.Provenance}");
            TestContext.Out.WriteLine(
                $"{view}: sealDoorHeads={profile.Options.SealDoorHeads} " +
                $"sealWallRunGaps={profile.Options.SealWallRunGaps} " +
                $"doorHead={sealClasses.Count(c => c == Detector.SealDoorHead) * cellSqft:F0}sf " +
                $"doorHeadOversize={sealClasses.Count(c => c == Detector.SealDoorHeadOversize) * cellSqft:F0}sf " +
                $"wallRunGap={sealClasses.Count(c => c == Detector.SealWallRunGap) * cellSqft:F0}sf " +
                $"gapClose={sealClasses.Count(c => c == Detector.SealGapClose) * cellSqft:F0}sf");
            var zones = ZonesFor(view)
                .Where(zone => zoneFilter == null
                    || zone.Name.Contains(zoneFilter, StringComparison.OrdinalIgnoreCase))
                .ToList();
            for (int zoneIndex = 0; zoneIndex < zones.Count; zoneIndex++)
            {
                var zone = zones[zoneIndex];
                string slug = $"{levelIndex + 1:D2}_{zoneIndex + 1:D2}_{Slug(zone.Name)}";
                string progress = Path.Combine(artifactDir, "zones", $"timing_{slug}.txt");
                var mask = zone.CellMask(snap.Field);
                var census = ZoneCensus.Compute(
                    snap.SeedInk, mask, snap.Field.W, snap.Field.H, snap.Field.CellFt);
                var timer = System.Diagnostics.Stopwatch.StartNew();
                int whiteoutCells = 0;
                ZoneDomainDiagnostics? domainDiagnostics = null;
                var result = prepared == null
                    ? TakeoffPolicy.Detect(snap, profile, _ => { }, zoneMask: mask)
                    : prepared.Detect(
                        zone, _ => { }, out whiteoutCells, out domainDiagnostics,
                        distanceToWallInk);
                long rawMilliseconds = timer.ElapsedMilliseconds;
                File.WriteAllText(Path.Combine(rawZonesDir, $"rooms_{slug}.tsv"), result.ToTsv());
                File.WriteAllText(progress, $"raw={rawMilliseconds}ms\nstage=promotion\n");
                timer.Restart();
                // Per-zone policy reads the census and the raw partition — both settled before any
                // gate has run — and may hand THIS zone different knobs. Its deviations ride into
                // report.json so a zone's disposition stays attributable to the knobs it got.
                var stats = ZonePartitionStats.Of(result, census.ZoneSqft);
                var policy = ZonePolicy.Adapt(census, stats, profile.Options);
                var promotion = TakeoffPromotion.PromoteZone(
                    result, zone, policy.Options, distanceToInk,
                    message => File.AppendAllText(progress, message + Environment.NewLine),
                    census, distanceToWallInk, snap.HeuristicClosureAt(profile),
                    (stage, snapshot) => {
                        string path = Path.Combine(
                            artifactDir, "promotion-stages", stage, $"rooms_{slug}.tsv");
                        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                        File.WriteAllText(path, snapshot.ToTsv());
                    });
                var triage = promotion.Diagnostics.Triage ?? ZoneTriageVerdict.Solve;
                IReadOnlyList<ZoneDomainHeldCandidate> reviewHeldCandidates = domainDiagnostics == null
                    ? []
                    : TakeoffPromotion.NormalizeDomainRefloodHeldCandidates(
                        domainDiagnostics.HeldCandidates, promotion.Result);
                long promotionMilliseconds = timer.ElapsedMilliseconds;
                // Append, not overwrite: the promotion stage log written above this point is the
                // per-zone tuning evidence, and rewriting the file would erase it.
                File.AppendAllText(progress,
                    $"promotion={promotionMilliseconds}ms\nstage=done\n");
                Interlocked.Increment(ref zonesRun);

                if (result.DomainSqft == 0)
                {
                    if (result.Rooms.Count > 0)
                        failures.Add($"{zone.Name}: rooms without domain");
                    Interlocked.Increment(ref abstained);
                }
                if (result.Rooms.Count > 0) Interlocked.Increment(ref zonesWithRooms);

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
                // abstention, not a pass — the law demands visibility, not success. A triage-held
                // zone is EXEMPT: the verdict is itself the stated abstention reason, which is
                // exactly the visibility this gate exists to force. Containment, closure and
                // determinism stay mandatory for held zones.
                int oracleInside = oracle.Count(c => ZoneScope.ContainsEvenOdd(zone.Loops, c.X, c.Y));
                if (!triage.IsHold && oracleInside >= 2
                    && result.Rooms.Count == 0 && result.Residues.Count == 0
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
                if (!triage.IsHold && oracleInside >= 2 && promotion.Result.Rooms.Count == 0
                    && promotion.Result.Residues.Count == 0
                    && promotion.Result.ExcludedResidueSqft == 0)
                    failures.Add($"{zone.Name}: promoted result vacuously hides {oracleInside} oracle rooms");

                string tsv = Path.Combine(artifactDir, "zones", $"rooms_{slug}.tsv");
                File.WriteAllText(tsv, promotion.Result.ToTsv());
                int doorHeadCells = 0, doorHeadOversizeCells = 0, wallRunCells = 0, gapCloseCells = 0;
                for (int i = 0; i < sealClasses.Length; i++)
                {
                    if (!mask[i]) continue;
                    switch (sealClasses[i])
                    {
                        case Detector.SealDoorHead: doorHeadCells++; break;
                        case Detector.SealDoorHeadOversize: doorHeadOversizeCells++; break;
                        case Detector.SealWallRunGap: wallRunCells++; break;
                        case Detector.SealGapClose: gapCloseCells++; break;
                    }
                }
                var points = zone.Loops.SelectMany(loop => loop).ToList();
                double zoneMinX = points.Min(point => point[0]);
                double zoneMinY = points.Min(point => point[1]);
                double zoneMaxX = points.Max(point => point[0]);
                double zoneMaxY = points.Max(point => point[1]);
                reports.Add(new PromotionZoneReport(
                    view,
                    zone.Name,
                    zoneMinX,
                    zoneMinY,
                    zoneMaxX,
                    zoneMaxY,
                    zone.Loops,
                    Path.GetRelativePath(artifactDir, tsv).Replace('\\', '/'),
                    Path.GetRelativePath(artifactDir, copiedInk).Replace('\\', '/'),
                    Path.GetRelativePath(artifactDir, sealBin).Replace('\\', '/'),
                    Path.GetRelativePath(artifactDir, closeBin).Replace('\\', '/'),
                    rawMilliseconds,
                    promotionMilliseconds,
                    oracleInside,
                    result.Rooms.Count,
                    promotion.Diagnostics.SharedNetworkStrictRooms,
                    promotion.Diagnostics.AcceptedRooms,
                    promotion.Diagnostics.HeldRooms,
                    promotion.Diagnostics.TinyMerged,
                    promotion.Diagnostics.PartitionSqft,
                    promotion.Diagnostics.AcceptedSqft,
                    promotion.Diagnostics.HeldSqft,
                    promotion.Diagnostics.VoidSqft,
                    promotion.Diagnostics.ExcludedSqft,
                    promotion.Diagnostics.ZoneSqft,
                    promotion.Diagnostics.HeldFraction,
                    promotion.Diagnostics.VoidFraction,
                    promotion.Diagnostics.InkBackedEdgeFraction,
                    promotion.Diagnostics.ClosureErrorSqft,
                    promotion.Diagnostics.GapSqft,
                    promotion.Diagnostics.OverlapSqft,
                    promotion.Diagnostics.OutsideZoneSqft,
                    promotion.Diagnostics.IsStrictlyEditable,
                    promotion.Diagnostics.IsContained,
                    promotion.Diagnostics.SharedEdgePairs,
                    promotion.Diagnostics.LostSharedEdgePairs,
                    promotion.Diagnostics.Rejections,
                    promotion.Diagnostics.RejectionDetails,
                    new {
                        zoneSqft = census.ZoneSqft,
                        inkSqft = census.InkSqft,
                        inkRatio = census.InkRatio,
                        floatingClusterCells = census.InkClusterCells,
                        edgeBandInkFraction = census.EdgeBandInkFraction,
                    },
                    new {
                        verdict = triage.IsHold ? "hold" : "solve",
                        reason = triage.Reason,
                    },
                    whiteoutCells,
                    domainDiagnostics == null ? null : new {
                        preparedDomainSqft = domainDiagnostics.PreparedDomainSqft,
                        cropRecomputedDomainSqft = domainDiagnostics.CropRecomputedDomainSqft,
                        lostComponents = domainDiagnostics.LostComponents.Select(component => new {
                            areaSqft = component.AreaSqft,
                            polygons = component.Polygons,
                        }),
                        heldCandidates = reviewHeldCandidates.Select(candidate => new {
                            id = candidate.Id,
                            areaSqft = candidate.AreaSqft,
                            polygons = candidate.Polygons,
                        }),
                        exclusionProvenance = domainDiagnostics.ExclusionProvenance,
                    },
                    new {
                        rawRooms = stats.RawRooms,
                        medianRawRoomSqft = stats.MedianRawRoomSqft,
                        roomsPer1000Sqft = stats.RoomsPer1000Sqft,
                    },
                    policy.AdaptedKnobs,
                    (doorHeadCells + doorHeadOversizeCells + wallRunCells) * cellSqft,
                    new {
                        doorHeadSqft = doorHeadCells * cellSqft,
                        doorHeadOversizeSqft = doorHeadOversizeCells * cellSqft,
                        wallRunGapSqft = wallRunCells * cellSqft,
                        gapCloseSqft = gapCloseCells * cellSqft,
                    },
                    ZoneKey(view, zoneMinX, zoneMinY, zoneMaxX, zoneMaxY)));
                TestContext.Out.WriteLine(
                    $"{zone.Name}: raw={result.Rooms.Count} accepted={promotion.Diagnostics.AcceptedRooms} " +
                    $"held={promotion.Diagnostics.HeldRooms} ink={promotion.Diagnostics.InkBackedEdgeFraction:P0} " +
                    $"closure={promotion.Diagnostics.ClosureErrorSqft:F3}sf " +
                    $"time={rawMilliseconds}+{promotionMilliseconds}ms oracle={oracleInside}");
            }
        });
        var orderedReports = reports
            .OrderBy(report => Array.FindIndex(LevelMap, item => item.View == report.Level))
            .ThenBy(report => report.Zone, StringComparer.Ordinal)
            .ToList();
        int rawTsvCount = Directory.GetFiles(rawZonesDir, "rooms_*.tsv").Length;
        if (rawTsvCount != zonesRun)
            failures.Add($"raw TSV census: expected {zonesRun}, found {rawTsvCount}");
        // Self-describing artifact: two runs are only comparable if the knobs that produced them
        // travel with them. The hash is over canonical (key-sorted, unindented) JSON of the
        // effective options, so a knob change is one visibly different token.
        var canonicalLevel = LevelMap.Select(item => item.View)
            .FirstOrDefault(effectiveOptions.ContainsKey);
        var canonicalOptions = canonicalLevel == null ? new TakeoffOptions()
            : effectiveOptions[canonicalLevel];
        File.WriteAllText(Path.Combine(artifactDir, "report.json"),
            JsonConvert.SerializeObject(new {
                // v3 added per-zone closure attribution (closureSqft/closure) and the Seals/Close
                // raster paths; v4 adds zoneKey (stable cross-run zone identity — sha256 of level
                // + 0.5ft-quantized bbox) and, additively (2026-08-17, still v4), zoneFilter.
                // Readers tolerate absence, so older artifacts still render — they just cannot
                // claim what they do not carry.
                SchemaVersion = 4,
                GeneratedUtc = DateTimeOffset.UtcNow,
                options = JsonConvert.DeserializeObject(JsonConvert.SerializeObject(canonicalOptions)),
                optionsHash = OptionsHash(canonicalOptions, zoneFilter),
                // Partial-run truth: the PE_TAKEOFF_ZONE filter this run executed under. An
                // explicit null says "unfiltered — the full baseline scope"; a pre-field package
                // lacks the key entirely and can only be assessed heuristically.
                zoneFilter,
                // Level-profile inference can hand each level its own effective options; per-level
                // hashes make that divergence visible instead of hiding behind one top-level blob.
                optionsHashPerLevel = LevelMap.Select(item => item.View)
                    .Where(effectiveOptions.ContainsKey)
                    .ToDictionary(view => view, view => OptionsHash(effectiveOptions[view]),
                        StringComparer.Ordinal),
                Zones = orderedReports,
                RejectionHistogram = orderedReports.SelectMany(report => report.Rejections)
                    .GroupBy(item => item.Key, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.Sum(item => item.Value),
                        StringComparer.Ordinal),
            }, Formatting.Indented) + Environment.NewLine);
        TestContext.Out.WriteLine(
            $"zones={zonesRun} withRooms={zonesWithRooms} abstained={abstained} " +
            $"artifact={artifactDir}");
        // Auto-persist every run into the pool the /runs dev surface scrolls. Pool lives in
        // .artifacts by ruling (kaitpw 2026-08-16: occasional wipes are no harm); PE_TAKEOFF_RUNS_DIR
        // points experiment worktrees at a shared pool when cross-worktree history matters.
        var runsPool = Environment.GetEnvironmentVariable("PE_TAKEOFF_RUNS_DIR")
            ?? Path.Combine(repoRoot, ".artifacts", "takeoff-runs");
        var runStamp = DateTimeOffset.UtcNow;
        var runId = $"{runStamp:yyyyMMdd-HHmmss}-{OptionsHash(canonicalOptions, zoneFilter)}";
        var runDir = Path.Combine(runsPool, runId);
        Directory.CreateDirectory(runDir);
        foreach (var file in Directory.EnumerateFiles(artifactDir, "*", SearchOption.AllDirectories))
        {
            var target = Path.Combine(runDir, Path.GetRelativePath(artifactDir, file));
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
        File.WriteAllText(Path.Combine(runDir, "meta.json"), JsonConvert.SerializeObject(new {
            runId,
            generatedUtc = runStamp,
            optionsHash = OptionsHash(canonicalOptions, zoneFilter),
            label = Environment.GetEnvironmentVariable("PE_TAKEOFF_RUN_LABEL"),
            // Duplicated from report.json so the index (which never opens reports) can mark
            // partial packages without a fetch. null = explicitly unfiltered.
            zoneFilter,
        }, Formatting.Indented) + Environment.NewLine);
        PersistScores(repoRoot, runDir);
        TestContext.Out.WriteLine($"run persisted: {runDir}");
        Assert.That(failures, Is.Empty, string.Join("\n", failures.OrderBy(item => item)));
    }

    /// <summary>
    /// scores.json joins the run package at persist time (SHIMS.md #1). The python scorer stays
    /// the single measure authority — the harness only invokes it against the run's own persisted
    /// report. A machine without python, or a scorer failure, degrades to an honest gap: the run
    /// carries no scores.json and the /runs surface says exactly that. It never fails the gate
    /// run, and it never becomes a TypeScript recompute.
    /// </summary>
    private static void PersistScores(string repoRoot, string runDir)
    {
        var psi = new System.Diagnostics.ProcessStartInfo {
            FileName = "python",
            WorkingDirectory = repoRoot,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add(Path.Combine(repoRoot, "eval", "rhvac", "score-looks-good.py"));
        psi.ArgumentList.Add("score");
        psi.ArgumentList.Add(Path.Combine(runDir, "report.json"));
        psi.ArgumentList.Add("--out");
        psi.ArgumentList.Add(Path.Combine(runDir, "scores.json"));
        try
        {
            using var process = System.Diagnostics.Process.Start(psi)
                ?? throw new InvalidOperationException("Process.Start returned null");
            var stdout = process.StandardOutput.ReadToEndAsync();
            var stderr = process.StandardError.ReadToEndAsync();
            if (!process.WaitForExit(600_000))
            {
                process.Kill(entireProcessTree: true);
                TestContext.Out.WriteLine("scores.json SKIPPED: scorer exceeded 10 minutes");
                return;
            }
            if (process.ExitCode != 0)
            {
                TestContext.Out.WriteLine(
                    $"scores.json SKIPPED: scorer exit {process.ExitCode}\n{stderr.Result.Trim()}");
                return;
            }
            TestContext.Out.WriteLine(
                $"scores.json written by score-looks-good.py: " +
                $"{stdout.Result.Split('\n').FirstOrDefault(l => l.Contains("board"))?.Trim()}");
        }
        catch (Exception exception) when (
            exception is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            TestContext.Out.WriteLine($"scores.json SKIPPED: python unavailable ({exception.Message})");
        }
    }

    [Test]
    public void Zone_filter_lands_in_options_hash()
    {
        // The 20260817-161144 law: a PE_TAKEOFF_ZONE run may never persist under the full
        // baseline's hash, and an unfiltered run keeps its historical hash.
        var options = new TakeoffOptions();
        Assert.Multiple(() => {
            Assert.That(OptionsHash(options, "Lower Level#08"), Is.Not.EqualTo(OptionsHash(options)));
            Assert.That(OptionsHash(options, null), Is.EqualTo(OptionsHash(options)));
            Assert.That(OptionsHash(options, "Lower Level#08"),
                Is.Not.EqualTo(OptionsHash(options, "Main Level#03")));
        });
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
        var timer = System.Diagnostics.Stopwatch.StartNew();
        var raw = snap.ReplayInferred(_ => { }, zoneMask: mask);
        TestContext.Out.WriteLine($"raw={timer.ElapsedMilliseconds}ms");
        timer.Restart();
        var profile = TakeoffPolicy.InferLevelProfile(snap);
        var cached = TakeoffPolicy.PrepareDetection(snap, profile, _ => { })
            .Detect(zone, _ => { });
        TestContext.Out.WriteLine($"prepared+detect={timer.ElapsedMilliseconds}ms");
        var distanceToInk = snap.SeedInkDistance();
        timer.Restart();
        var first = TakeoffPromotion.PromoteZone(
            cached, zone, profile.Options, distanceToInk);
        TestContext.Out.WriteLine($"promotion-first={timer.ElapsedMilliseconds}ms");
        timer.Restart();
        var second = TakeoffPromotion.PromoteZone(
            cached, zone, profile.Options, distanceToInk);
        TestContext.Out.WriteLine($"promotion-second={timer.ElapsedMilliseconds}ms");
        Assert.Multiple(() => {
            Assert.That(cached.ToTsv(), Is.EqualTo(raw.ToTsv()),
                "prepared level evidence must preserve real replay output byte-for-byte");
            Assert.That(second.Result.ToTsv(), Is.EqualTo(first.Result.ToTsv()));
            Assert.That(JsonConvert.SerializeObject(second.Diagnostics),
                Is.EqualTo(JsonConvert.SerializeObject(first.Diagnostics)));
        });
    }

    /// <summary>
    /// An A/B run is a different options record, so the harness lets one be declared instead of
    /// compiled: <c>PE_TAKEOFF_KNOBS="SmallZoneSqft=750;EdgeBandFt=2.0"</c>. Unset — the normal
    /// case — this changes nothing, and whatever it does change lands in report.json's
    /// <c>options</c>/<c>optionsHash</c>, so no artifact can be misattributed to the wrong knobs.
    /// PE_TAKEOFF_ZONE is the other run-shaping input, and it lands too — in
    /// <c>optionsHash</c>/runId AND explicitly as <c>zoneFilter</c> in report.json + meta.json.
    /// </summary>
    private static void ApplyKnobOverrides(TakeoffOptions options)
    {
        string? declared = Environment.GetEnvironmentVariable("PE_TAKEOFF_KNOBS");
        if (string.IsNullOrWhiteSpace(declared)) return;
        foreach (string entry in declared!.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = entry.Split('=', 2);
            if (parts.Length != 2)
                throw new InvalidOperationException($"PE_TAKEOFF_KNOBS entry '{entry}' is not name=value");
            var field = typeof(TakeoffOptions).GetField(parts[0].Trim())
                        ?? throw new InvalidOperationException($"no TakeoffOptions knob '{parts[0]}'");
            string value = parts[1].Trim();
            // An enum knob reads by name; a switch knob reads as 1/0 as naturally as true/false.
            field.SetValue(options,
                field.FieldType.IsEnum ? Enum.Parse(field.FieldType, value, ignoreCase: true)
                : field.FieldType == typeof(bool) && (value == "1" || value == "0") ? value == "1"
                : Convert.ChangeType(value, field.FieldType, CultureInfo.InvariantCulture));
        }
    }

    /// <summary>
    /// First 12 hex chars of SHA-256 over key-sorted, unindented JSON of the options. The zone
    /// filter is run IDENTITY, not a solver knob — but a PE_TAKEOFF_ZONE run must never hash like
    /// the full baseline (run 20260817-161144-5973e5c14825 carried 1 zone under the 45-zone
    /// baseline's hash and got picked as an A/B baseline). Filter absent = unfiltered = the
    /// historical hash, so every existing full package keeps its identity.
    /// </summary>
    private static string OptionsHash(TakeoffOptions options, string? zoneFilter = null)
    {
        var canonicalToken = (JObject)Canonical(JToken.FromObject(options));
        if (zoneFilter != null) canonicalToken["~zoneFilter"] = zoneFilter;
        string canonical = canonicalToken.ToString(Formatting.None);
        using var sha = System.Security.Cryptography.SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(Encoding.UTF8.GetBytes(canonical)))
            .ToLowerInvariant()[..12];
    }

    private static JToken Canonical(JToken token) => token switch {
        JObject o => new JObject(o.Properties().OrderBy(p => p.Name, StringComparer.Ordinal)
            .Select(p => new JProperty(p.Name, Canonical(p.Value)))),
        JArray a => new JArray(a.Select(Canonical)),
        _ => token,
    };

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
