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
