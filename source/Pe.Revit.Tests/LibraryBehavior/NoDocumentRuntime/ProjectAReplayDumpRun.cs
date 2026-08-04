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
    internal static TakeoffOptions PolicyFor(string levelName)
    {
        TakeoffOptions Flat() => new() {
            RequireCeiling = true, SealDoorHeads = true, SealWallRunGaps = true, MinCompactness = 0,
        };
        if (levelName.Contains("Lower Level") || levelName.Contains("Main Level")) return Flat();
        if (levelName.Contains("Upper Level"))
        {
            var o = Flat();
            o.StoryCapFt = 26;
            return o;
        }
        if (levelName.Contains("Attic"))
            return new TakeoffOptions {
                RequireCeiling = true, CeilingCloseFt = 3, StoryCapFt = 30, MinHeadroomFt = 3.5,
                SealDoorHeads = true, MinCompactness = 0,
            };
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

        string? formulation = Environment.GetEnvironmentVariable("PE_TAKEOFF_FORMULATION");
        Directory.CreateDirectory(outDir);
        foreach (string bin in bins)
        {
            var snap = DetectSnapshot.Load(bin);
            var opt = PolicyFor(snap.LevelName);
            if (!string.IsNullOrEmpty(formulation))
                opt.Formulation = Enum.Parse<TakeoffFormulation>(formulation, ignoreCase: true);
            var result = snap.Replay(opt, TestContext.Out.WriteLine);
            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            string tsv = Path.Combine(outDir, $"rooms_{name}.tsv");
            File.WriteAllText(tsv, result.ToTsv());
            TestContext.Out.WriteLine($"[dump] {snap.LevelName}: rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
        }
    }
}
