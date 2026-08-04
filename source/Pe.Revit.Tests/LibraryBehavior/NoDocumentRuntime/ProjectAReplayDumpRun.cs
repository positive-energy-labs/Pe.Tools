using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// Offline detection-loop driver: replays every captured project-a snapshot (replay_<level>.bin in
// the Documents takeoff dir) under the same per-level policy run-takeoff.py applies live, and
// writes the resulting rooms_<level>.tsv files to $PE_TAKEOFF_REPLAY_OUT. Score the dump with
// `python eval/rhvac/score-takeoff.py --takeoff-dir <out>`. This is the phase-2 iteration lane:
// change detection, dump, score — no Revit anywhere.
//
//   $env:PE_TAKEOFF_REPLAY_OUT = "<dir>"
//   $env:PE_TAKEOFF_FORMULATION = "Partition"   # optional; default = per-policy (Regions)
//   dotnet test -c Debug.R25.Tests --filter FullyQualifiedName~ProjectAReplayDumpRun
public sealed class ProjectAReplayDumpRun
{
    // Mirror of run-takeoff.py LEVEL_POLICY (matched by containment against the level name).
    // Only replay-honest knobs matter here — capture-baked ones (CeilingCloseFt, StoryCapFt
    // widening) are echoed for fidelity but cannot change what is in the bin.
    internal static TakeoffOptions PolicyFor(string levelName, TakeoffFormulation formulation = TakeoffFormulation.Regions)
    {
        TakeoffOptions Flat() => new() {
            RequireCeiling = true, SealDoorHeads = true, SealWallRunGaps = true, MinCompactness = 0,
        };
        // Partition seed policy (2026-08-04 offline campaign, all measured on the project-a replay):
        // Hybrid sub-seeding wins where ceiling-step evidence is trustworthy (L1 mIoU .495->.524,
        // attic .459->.473, merged 31->26) and loses where it is duct/beam noise (L0 .399->.327,
        // ceil-step wall-precision lift 1.1 vs 2.2 upstairs) — so Hybrid on Main/Upper/Attic,
        // RegionCores on basement levels. Mirror into run-takeoff.py LEVEL_POLICY when partition
        // goes live.
        bool hybrid = formulation == TakeoffFormulation.Partition;
        if (levelName.Contains("Lower Level")) return Flat();
        if (levelName.Contains("Main Level"))
        {
            var o = Flat();
            if (hybrid) o.SeedSource = TakeoffSeedSource.Hybrid;
            return o;
        }
        // Theatre joins FLAT under the partition formulation only: its stock options worked under
        // Regions because border-rejection ate the covered apron, but the partition needs the same
        // RequireCeiling domain gate every other flat level uses (32k sf of fake apron rooms
        // otherwise). Mirror into run-takeoff.py LEVEL_POLICY when partition goes live.
        if (levelName.Contains("Theatre"))
            return formulation == TakeoffFormulation.Partition ? Flat() : new TakeoffOptions();
        if (levelName.Contains("Upper Level"))
        {
            var o = Flat();
            o.StoryCapFt = 26;
            if (hybrid) o.SeedSource = TakeoffSeedSource.Hybrid;
            return o;
        }
        if (levelName.Contains("Attic"))
        {
            var o = new TakeoffOptions {
                RequireCeiling = true, CeilingCloseFt = 3, StoryCapFt = 30, MinHeadroomFt = 3.5,
                SealDoorHeads = true, MinCompactness = 0,
            };
            if (hybrid) o.SeedSource = TakeoffSeedSource.Hybrid;
            // Measured 2026-08-04: dropping the door-head sealer on the attic (its obstruction
            // covers ~45% of GT interiors under sloped ceilings) REGRESSED mIoU .459 -> .401 —
            // the sealer's splits outweigh its interior pollution. Keep it.
            if (Environment.GetEnvironmentVariable("PE_TAKEOFF_ATTIC_NOSEAL") == "1")
                o.SealDoorHeads = false;
            return o;
        }
        return new TakeoffOptions(); // Theatre and anything unmatched: stock options
    }

    internal static List<string> FindSnapshots() =>
        new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "replay_*.bin"))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();

    [Test]
    [Explicit("Operational dump lane; needs PE_TAKEOFF_REPLAY_OUT and live-captured snapshots.")]
    public void Dump_replayed_tsvs()
    {
        string? outDir = Environment.GetEnvironmentVariable("PE_TAKEOFF_REPLAY_OUT");
        if (string.IsNullOrEmpty(outDir))
            Assert.Ignore("set PE_TAKEOFF_REPLAY_OUT to the directory the replayed TSVs should land in");
        var bins = FindSnapshots();
        if (bins.Count == 0)
            Assert.Ignore("no replay_*.bin captured yet — run eval/rhvac/run-takeoff.py once live");

        string? formulationVar = Environment.GetEnvironmentVariable("PE_TAKEOFF_FORMULATION");
        var formulation = string.IsNullOrEmpty(formulationVar)
            ? TakeoffFormulation.Regions
            : Enum.Parse<TakeoffFormulation>(formulationVar, ignoreCase: true);
        string? seedSource = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEEDS");
        string? seedLevels = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEED_LEVELS"); // e.g. "Main;Upper;Attic"
        Directory.CreateDirectory(outDir);
        foreach (string bin in bins)
        {
            var snap = DetectSnapshot.Load(bin);
            var opt = PolicyFor(snap.LevelName, formulation);
            opt.Formulation = formulation;
            if (!string.IsNullOrEmpty(seedSource)
                && (string.IsNullOrEmpty(seedLevels)
                    || seedLevels.Split(';').Any(snap.LevelName.Contains)))
                opt.SeedSource = Enum.Parse<TakeoffSeedSource>(seedSource, ignoreCase: true);
            if (Environment.GetEnvironmentVariable("PE_TAKEOFF_SNAP") == "0")
                opt.SnapBoundaries = false; // phase-3 A/B escape: pre-snap partition output
            var lines = new List<string>();
            var result = snap.Replay(opt, lines.Add);
            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            string tsv = Path.Combine(outDir, $"rooms_{name}.tsv");
            File.WriteAllText(tsv, result.ToTsv());
            lines.Add($"[dump] {snap.LevelName}: rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
            File.WriteAllLines(Path.Combine(outDir, $"log_{name}.txt"), lines);
            foreach (string l in lines) TestContext.Out.WriteLine(l);
        }
    }

    [Test]
    [Explicit("Diagnosis/calibration lane; needs PE_TAKEOFF_DIAG_OUT and live-captured snapshots.")]
    public void Dump_partition_diagnostics()
    {
        string? outDir = Environment.GetEnvironmentVariable("PE_TAKEOFF_DIAG_OUT");
        if (string.IsNullOrEmpty(outDir))
            Assert.Ignore("set PE_TAKEOFF_DIAG_OUT to the directory the diagnostic rasters should land in");
        var bins = FindSnapshots();
        if (bins.Count == 0)
            Assert.Ignore("no replay_*.bin captured yet");
        Directory.CreateDirectory(outDir);
        foreach (string bin in bins)
        {
            var snap = DetectSnapshot.Load(bin);
            var opt = PolicyFor(snap.LevelName, TakeoffFormulation.Partition);
            opt.Formulation = TakeoffFormulation.Partition;
            var obst = Detector.BuildObstruction(snap.Field, snap.SeedInk, snap.LevelElevation, opt, _ => { });
            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            PartitionFormulation.DumpDiagnostics(
                Path.Combine(outDir, $"diag_{name}.bin"), snap.Field, obst, snap.LevelElevation, opt);
            TestContext.Out.WriteLine($"[diag] {snap.LevelName} -> diag_{name}.bin");
        }
    }
}
