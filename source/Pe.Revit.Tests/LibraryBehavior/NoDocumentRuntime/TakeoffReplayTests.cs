using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// The offline detection loop: DetectSnapshot persists exactly what Detector.Detect consumes
// (heightfield + composed seed ink + level identity); Replay reruns region detection +
// polygonization with arbitrary TakeoffOptions, no Revit anywhere. These tests prove the loop on
// a synthetic-but-non-trivial scene (four rooms, two 3-ft door gaps, a diagonal wall, an
// open-plan area); ProjectA_snapshot_replays_deterministically upgrades to the real captured
// project-a state automatically once a live run has produced replay_<level>.bin (run-takeoff.py —
// capture is on by default via TakeoffOptions.DumpReplaySnapshot).
public sealed class TakeoffReplayTests
{
    // 60 x 40 ft at 0.5 ft cells. Envelope ring; west block split into rooms A/B by a wall with a
    // 3-ft door gap; a full-height divider with a second 3-ft door gap onto the east open-plan
    // area; a 45-degree diagonal wall sealing a triangular room off the open plan's SE corner.
    // Every floor cell carries a 9-ft ceiling, so ceiling gates pass and door gaps are the only
    // topology question: unsealed they merge A+B+open-plan into one region.
    private static DetectSnapshot BuildSyntheticEstate()
    {
        const int W = 120, H = 80;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 8; y < 72; y++)
            for (int x = 8; x < 112; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }

        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                    ink[y * W + x] = true;
        }
        Stamp(8, 112, 8, 10); Stamp(8, 112, 70, 72);     // envelope south/north
        Stamp(8, 10, 8, 72); Stamp(110, 112, 8, 72);     // envelope west/east
        Stamp(48, 50, 8, 20); Stamp(48, 50, 26, 72);     // divider, 3-ft door gap y=[20,26)
        Stamp(8, 28, 40, 42); Stamp(34, 48, 40, 42);     // A/B wall, 3-ft door gap x=[28,34)
        for (int t = 0; t <= 30; t++) Stamp(80 + t, 82 + t, 8 + t, 10 + t); // diagonal, 2 cells thick

        return new DetectSnapshot {
            LevelName = "Synthetic Level", LevelElevation = 0,
            CaptureOptions = "synthetic", Field = hf, SeedInk = ink,
        };
    }

    private static TakeoffOptions ReplayOptions(bool sealDoorGaps) => new() {
        CellFt = 0.5, SealWallRunGaps = sealDoorGaps,
    };

    private static string TempPath(string name) =>
        Path.Combine(Path.GetTempPath(), $"pe-takeoff-replay-{Guid.NewGuid():N}-{name}");

    [Test]
    public void Replay_is_deterministic_and_option_sensitive()
    {
        string path = TempPath("estate.bin");
        try
        {
            DetectSnapshot.Save(path, BuildSyntheticEstate());
            var snap = DetectSnapshot.Load(path);

            var sealedRun = snap.Replay(ReplayOptions(sealDoorGaps: true), _ => { });
            var openRun = snap.Replay(ReplayOptions(sealDoorGaps: false), _ => { });

            // Sealed: A, B, open-plan, diagonal triangle. Unsealed: the two door gaps merge
            // A+B+open-plan into one region; only the triangle stays separate.
            Assert.Multiple(() => {
                Assert.That(sealedRun.Rooms, Has.Count.EqualTo(4));
                Assert.That(openRun.Rooms, Has.Count.EqualTo(2));
                Assert.That(sealedRun.LevelName, Is.EqualTo("Synthetic Level"));
                Assert.That(sealedRun.Rooms.All(r => r.RawSqft >= 80), Is.True);
                Assert.That(sealedRun.Rooms.All(r => r.Polygon.Count >= 3), Is.True);
            });

            // Determinism: a second replay from a second load produces the byte-identical TSV
            // (the same payload the live lane commits to eval/rhvac/<project>/takeoff/).
            var again = DetectSnapshot.Load(path).Replay(ReplayOptions(sealDoorGaps: true), _ => { });
            string tsvA = TempPath("a.tsv"), tsvB = TempPath("b.tsv");
            try
            {
                File.WriteAllText(tsvA, sealedRun.ToTsv());
                File.WriteAllText(tsvB, again.ToTsv());
                Assert.That(File.ReadAllBytes(tsvB), Is.EqualTo(File.ReadAllBytes(tsvA)));
            }
            finally { File.Delete(tsvA); File.Delete(tsvB); }
        }
        finally { File.Delete(path); }
    }

    [Test]
    public void Snapshot_roundtrip_is_byte_identical()
    {
        string first = TempPath("first.bin"), second = TempPath("second.bin");
        try
        {
            DetectSnapshot.Save(first, BuildSyntheticEstate());
            var loaded = DetectSnapshot.Load(first);
            DetectSnapshot.Save(second, loaded);
            Assert.That(File.ReadAllBytes(second), Is.EqualTo(File.ReadAllBytes(first)));
            Assert.That(loaded.CaptureOptions, Is.EqualTo("synthetic"));
        }
        finally { File.Delete(first); File.Delete(second); }
    }

    [Test]
    public void Replay_fail_fasts_on_cell_size_mismatch()
    {
        var snap = BuildSyntheticEstate(); // 0.5 ft cells
        Assert.That(
            () => snap.Replay(new TakeoffOptions(), _ => { }), // default CellFt = 0.25
            Throws.InvalidOperationException.With.Message.Contains("CellFt"));
    }

    // ---- partition formulation semantics (phase 2, eval/rhvac/PHASE2-PARTITION.md) ----

    private static TakeoffOptions PartitionOptions() => new() {
        CellFt = 0.5, Formulation = TakeoffFormulation.Partition, SealWallRunGaps = true,
    };

    [Test]
    public void Partition_assigns_every_domain_cell_with_no_slivers_or_overlaps()
    {
        var snap = BuildSyntheticEstate();
        var run = snap.Replay(PartitionOptions(), _ => { });

        // The estate's domain is the full floored rectangle x[8,112) y[8,72) = 52ft x 32ft,
        // wall/ink cells included (floor + 9-ft ceiling everywhere). Assignment totality + no
        // overlap means the emitted room areas sum EXACTLY to the domain area — no holes by
        // construction, wall thickness split between neighbors, nothing double-claimed.
        const double domainSqft = 52 * 32;
        Assert.Multiple(() => {
            Assert.That(run.Rooms.Sum(r => r.RawSqft), Is.EqualTo(domainSqft).Within(1e-6));
            Assert.That(run.Rooms, Has.Count.EqualTo(4)); // A, B, open-plan, diagonal triangle
            Assert.That(run.Rooms.All(r => r.RawSqft >= new TakeoffOptions().MinSqft), Is.True,
                "sliver dissolution must leave no under-min-area rooms");
        });

        // Shared boundaries by construction: polygon areas tile the domain (sum of outer areas
        // minus holes equals the domain area too, so adjacent outlines cannot overlap or gap).
        double Shoe(List<double[]> p)
        {
            double s = 0;
            for (int i = 0; i < p.Count; i++)
            { var a = p[i]; var b = p[(i + 1) % p.Count]; s += a[0] * b[1] - b[0] * a[1]; }
            return Math.Abs(s / 2);
        }
        double polyArea = run.Rooms.Sum(r => Shoe(r.Polygon) - r.Holes.Sum(Shoe));
        Assert.That(polyArea, Is.EqualTo(domainSqft).Within(1e-6));
    }

    [Test]
    public void Partition_replay_is_deterministic()
    {
        string path = TempPath("estate-part.bin");
        try
        {
            DetectSnapshot.Save(path, BuildSyntheticEstate());
            var first = DetectSnapshot.Load(path).Replay(PartitionOptions(), _ => { });
            var second = DetectSnapshot.Load(path).Replay(PartitionOptions(), _ => { });
            Assert.That(second.ToTsv(), Is.EqualTo(first.ToTsv()));
        }
        finally { File.Delete(path); }
    }

    // Open-plan scene: one long 6-ft-tall space whose midpoint has only half-foot wall stubs —
    // enough to break the seed plateau's 3-ft clearance (hybrid splits there), while the shared
    // boundary stays ~83% unbacked by evidence, so the merge criterion re-merges the halves and
    // FLAGS the merge; the flag must ride the TSV as a backward-compatible 3-column META line.
    [Test]
    public void Partition_flags_open_plan_merges()
    {
        const int W = 120, H = 28;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 6; y < 22; y++)
            for (int x = 8; x < 112; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }
        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++) ink[y * W + x] = true;
        }
        Stamp(8, 112, 6, 8); Stamp(8, 112, 20, 22);   // long north/south walls
        Stamp(8, 10, 6, 22); Stamp(110, 112, 6, 22);  // end walls
        Stamp(59, 61, 8, 9); Stamp(59, 61, 19, 20);   // half-foot stubs at the midpoint

        var snap = new DetectSnapshot {
            LevelName = "Open Plan", LevelElevation = 0, CaptureOptions = "synthetic",
            Field = hf, SeedInk = ink,
        };
        // The watershed boundary hugs the stub pinch, so its evidence backing sits just above the
        // default merge bar (it draws the low-evidence flag there). Semantics under test are
        // parametric: below MinBoundarySupport the halves are ONE open-plan space, flagged.
        var opt = PartitionOptions();
        opt.SeedSource = TakeoffSeedSource.Hybrid;
        var split = snap.Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(split.Rooms, Has.Count.EqualTo(2), "the pinch must split the hybrid seeds");
            Assert.That(split.Rooms.SelectMany(r => r.Flags), Does.Contain("low-evidence-boundary"));
        });

        opt.MinBoundarySupport = 0.75; // stricter wall-backing demand -> this boundary is open-plan
        var strict = snap.Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(strict.Rooms, Has.Count.EqualTo(1), "unbacked split must merge back");
            Assert.That(strict.Rooms[0].Flags, Does.Contain("open-plan-merge"));
            Assert.That(strict.ToTsv(), Does.Contain($"META\tflag\t{strict.Rooms[0].Id}:"));
        });
    }

    // ---- phase-3 wall-line snapping semantics (BoundarySnap.cs) ----

    [Test]
    public void Snap_diagnostics_account_for_every_boundary_chain()
    {
        var snap = BuildSyntheticEstate();
        var opt = PartitionOptions();
        var diagnostics = opt.SnapDiagnostics = new();

        snap.Replay(opt, _ => { });

        Assert.Multiple(() => {
            Assert.That(diagnostics, Is.Not.Empty);
            Assert.That(diagnostics.All(d => d.LengthFt > 0), Is.True);
            Assert.That(diagnostics.All(d => BoundarySnapDiagnostic.Outcomes.Contains(d.Outcome)), Is.True);
            Assert.That(diagnostics.Sum(d => d.LengthFt), Is.GreaterThan(0));
        });
    }

    [Test]
    public void Snap_keeps_door_gap_rooms_separate_with_bounded_area_drift()
    {
        var snap = BuildSyntheticEstate();
        var opt = PartitionOptions();
        var snapped = snap.Replay(opt, _ => { });
        opt.SnapBoundaries = false;
        var raw = snap.Replay(opt, _ => { });

        // Same partition topology: door-gap rooms stay separate, nothing merges or vanishes.
        Assert.That(snapped.Rooms, Has.Count.EqualTo(raw.Rooms.Count));
        Assert.That(snapped.Rooms, Has.Count.EqualTo(4));

        // Rectangular rooms become exact 4-vertex rectangles; the small triangle's hypotenuse
        // straightens where the fit fits and keeps honest raw ends where full corner restoration
        // would break the area bound (the staged guard demotes, never distorts).
        var triSnap = snapped.Rooms.OrderBy(r => r.RawSqft).First();
        var triRaw = raw.Rooms.OrderBy(r => r.RawSqft).First();
        Assert.Multiple(() => {
            Assert.That(snapped.Rooms.Count(r => r.Polygon.Count == 4), Is.GreaterThanOrEqualTo(2),
                "axis-walled rooms must be exact rectangles");
            Assert.That(triSnap.Polygon.Count, Is.LessThan(triRaw.Polygon.Count),
                "hypotenuse must at least partially straighten");
        });

        // Area is exported truth: per-room drift from snapping stays within max(0.5 sqft, 1%).
        var rawByArea = raw.Rooms.OrderBy(r => r.RawSqft).ToList();
        var snapByArea = snapped.Rooms.OrderBy(r => r.RawSqft).ToList();
        for (int i = 0; i < rawByArea.Count; i++)
            Assert.That(Math.Abs(snapByArea[i].RawSqft - rawByArea[i].RawSqft),
                Is.LessThanOrEqualTo(Math.Max(0.5, 0.01 * rawByArea[i].RawSqft)),
                $"area drift bound violated for room {rawByArea[i].Id}");
    }

    [Test]
    public void Snap_straightens_diagonal_wall_into_single_segment()
    {
        // A large diagonal-walled triangle (legs ~40 ft, ~840 sf): the 1% area bound then
        // accommodates honest corner restoration (watershed fronts drift a couple of feet inside
        // wall-JOINT ink), so the staircase hypotenuse must come out as exactly ONE segment —
        // a 3-vertex triangle polygon.
        const int W = 200, H = 120;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 8; y < 112; y++)
            for (int x = 8; x < 192; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }
        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++) ink[y * W + x] = true;
        }
        Stamp(8, 192, 8, 10); Stamp(8, 192, 110, 112);   // envelope south/north
        Stamp(8, 10, 8, 112); Stamp(190, 192, 8, 112);   // envelope west/east
        for (int t = 0; t <= 80; t++) Stamp(110 + t, 112 + t, 8 + t, 10 + t); // 45-deg diagonal

        var snap = new DetectSnapshot {
            LevelName = "Diagonal", LevelElevation = 0, CaptureOptions = "synthetic",
            Field = hf, SeedInk = ink,
        };
        var opt = PartitionOptions();
        var snapLog = new List<string>();
        var snapped = snap.Replay(opt, snapLog.Add);
        opt.SnapBoundaries = false;
        var raw = snap.Replay(opt, _ => { });

        Assert.That(snapped.Rooms, Has.Count.EqualTo(2));
        var triSnap = snapped.Rooms.OrderBy(r => r.RawSqft).First();
        var triRaw = raw.Rooms.OrderBy(r => r.RawSqft).First();
        Assert.Multiple(() => {
            Assert.That(triRaw.Polygon.Count, Is.GreaterThan(20), "control: raster staircase");
            Assert.That(triSnap.Polygon.Count, Is.EqualTo(3),
                "hypotenuse must be ONE segment; polygon=" +
                string.Join(" ", triSnap.Polygon.Select(v => $"({v[0]:F2},{v[1]:F2})")) +
                "; log=" + string.Join(" | ", snapLog));
            Assert.That(Math.Abs(triSnap.RawSqft - triRaw.RawSqft),
                Is.LessThanOrEqualTo(Math.Max(0.5, 0.01 * triRaw.RawSqft)), "area bound");
        });
    }

    [Test]
    public void Snap_leaves_no_evidence_boundaries_raw()
    {
        // The open-plan pinch scene: the watershed boundary between the two halves crosses open
        // floor with no wall evidence (half-foot stubs only). Snapping must NOT invent a wall
        // there — the mid-span boundary geometry stays byte-identical to the unsnapped run,
        // while the real (ink-backed) walls are straight lines in both runs.
        const int W = 120, H = 28;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 6; y < 22; y++)
            for (int x = 8; x < 112; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }
        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++) ink[y * W + x] = true;
        }
        Stamp(8, 112, 6, 8); Stamp(8, 112, 20, 22);
        Stamp(8, 10, 6, 22); Stamp(110, 112, 6, 22);
        Stamp(59, 61, 8, 9); Stamp(59, 61, 19, 20);
        var snap = new DetectSnapshot {
            LevelName = "Open Plan", LevelElevation = 0, CaptureOptions = "synthetic",
            Field = hf, SeedInk = ink,
        };

        var opt = PartitionOptions();
        opt.SeedSource = TakeoffSeedSource.Hybrid;
        var snappedRun = snap.Replay(opt, _ => { });
        opt.SnapBoundaries = false;
        var rawRun = snap.Replay(opt, _ => { });
        Assert.That(snappedRun.Rooms, Has.Count.EqualTo(2));
        Assert.That(rawRun.Rooms, Has.Count.EqualTo(2));

        // Mid-span (away from the stubs' reach): the unbacked split boundary is unchanged.
        static List<string> MidVerts(TakeoffResult r) => r.Rooms
            .SelectMany(rm => rm.Polygon)
            .Where(v => v[0] > 26 && v[0] < 34 && v[1] > 5 && v[1] < 9)
            .Select(v => FormattableString.Invariant($"{v[0]:F6};{v[1]:F6}"))
            .OrderBy(s => s, StringComparer.Ordinal)
            .ToList();
        Assert.That(MidVerts(snappedRun), Is.EqualTo(MidVerts(rawRun)),
            "no-evidence boundary must stay as-is (jaggedness is information)");
    }

    [Test]
    public void Snap_without_evidence_is_byte_identical_to_control()
    {
        var snap = BuildSyntheticEstate();
        snap.SeedInk = new bool[snap.Field.W * snap.Field.H];
        var opt = PartitionOptions();
        var snapped = snap.Replay(opt, _ => { });
        opt.SnapBoundaries = false;
        var control = snap.Replay(opt, _ => { });

        Assert.That(snapped.ToTsv(), Is.EqualTo(control.ToTsv()));
    }

    [Test]
    public void Snap_option_does_not_change_regions()
    {
        var snap = BuildSyntheticEstate();
        var opt = new TakeoffOptions { CellFt = snap.Field.CellFt, SnapBoundaries = false };
        var control = snap.Replay(opt, _ => { });
        opt.SnapBoundaries = true;

        Assert.That(snap.Replay(opt, _ => { }).ToTsv(), Is.EqualTo(control.ToTsv()));
    }

    [Test]
    public void ProjectA_snapshot_replays_deterministically()
    {
        // Real-data replay: activates once any live Detect run has captured a snapshot.
        var candidates = new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "replay_*.bin"))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
        if (candidates.Count == 0)
            Assert.Ignore("no live capture yet — the next eval/rhvac/run-takeoff.py run writes replay_<level>.bin automatically");

        var snap = DetectSnapshot.Load(candidates[0]);
        var opt = new TakeoffOptions { CellFt = snap.Field.CellFt };
        var first = snap.Replay(opt, _ => { });
        var second = DetectSnapshot.Load(candidates[0]).Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(first.Rooms, Is.Not.Empty);
            Assert.That(second.ToTsv(), Is.EqualTo(first.ToTsv()));
        });
    }
}
