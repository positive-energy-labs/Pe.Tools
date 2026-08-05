using Newtonsoft.Json;
using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// Offline detection-loop driver: replays captured snapshots under the evidence-derived library
// policy and writes rooms_<level>.tsv files to $PE_TAKEOFF_REPLAY_OUT. Score the dump with
// `python eval/rhvac/score-takeoff.py --takeoff-dir <out>`; no Revit is involved.
//
//   $env:PE_TAKEOFF_REPLAY_OUT = "<dir>"
//   $env:PE_TAKEOFF_REPLAY_FILTER = "replay_MAIN_LEVEL.bin;replay_ROOF_PLAN.bin" // optional
//   $env:PE_TAKEOFF_SNAP_DIAG_OUT = "<dir>" # optional per-chain JSON
//   $env:PE_TAKEOFF_FORMULATION = "Partition" # optional; default = Regions
//   $env:PE_TAKEOFF_POLICY = "Stock" # optional uninferred control; default = Inferred
public sealed class ProjectAReplayDumpRun
{
    internal static List<string> FindSnapshots()
    {
        string[] filter = (Environment.GetEnvironmentVariable("PE_TAKEOFF_REPLAY_FILTER") ?? "")
            .Split(new[] { ';' }, StringSplitOptions.RemoveEmptyEntries).Select(token => token.Trim()).ToArray();
        return new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "replay_*.bin"))
            .Where(path => filter.Length == 0 || filter.Any(token =>
                Path.GetFileName(path).Equals(token, StringComparison.OrdinalIgnoreCase)))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
    }

    [Test]
    [Explicit("Operational dump lane; needs PE_TAKEOFF_REPLAY_OUT and live-captured snapshots.")]
    public void Dump_replayed_tsvs()
    {
        string? outDir = Environment.GetEnvironmentVariable("PE_TAKEOFF_REPLAY_OUT");
        if (string.IsNullOrEmpty(outDir))
            Assert.Ignore("set PE_TAKEOFF_REPLAY_OUT to the directory the replayed TSVs should land in");
        var bins = FindSnapshots();
        if (bins.Count == 0)
            Assert.Ignore("no replay_*.bin captured yet; run eval/rhvac/run-takeoff.py once live");

        string? formulationVar = Environment.GetEnvironmentVariable("PE_TAKEOFF_FORMULATION");
        var formulation = string.IsNullOrEmpty(formulationVar)
            ? TakeoffFormulation.Regions
            : Enum.Parse<TakeoffFormulation>(formulationVar, ignoreCase: true);
        string? seedSource = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEEDS");
        string? seedLevels = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEED_LEVELS");
        string? snapDiagDir = Environment.GetEnvironmentVariable("PE_TAKEOFF_SNAP_DIAG_OUT");
        string policy = Environment.GetEnvironmentVariable("PE_TAKEOFF_POLICY") ?? "Inferred";
        bool inferred = policy.Equals("Inferred", StringComparison.OrdinalIgnoreCase);
        if (!inferred && !policy.Equals("Stock", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("PE_TAKEOFF_POLICY must be Inferred or Stock");
        Directory.CreateDirectory(outDir);
        if (!string.IsNullOrEmpty(snapDiagDir)) Directory.CreateDirectory(snapDiagDir);

        foreach (string bin in bins)
        {
            var snap = DetectSnapshot.Load(bin);
            var lines = new List<string>();
            TakeoffOptions? opt = null;
            void Configure(TakeoffOptions configured)
            {
                opt = configured;
                if (!string.IsNullOrEmpty(seedSource)
                    && (string.IsNullOrEmpty(seedLevels)
                        || seedLevels.Split(';').Any(snap.LevelName.Contains)))
                    opt.SeedSource = Enum.Parse<TakeoffSeedSource>(seedSource, ignoreCase: true);
                if (Environment.GetEnvironmentVariable("PE_TAKEOFF_SNAP") == "0")
                    opt.SnapBoundaries = false;
                if (!string.IsNullOrEmpty(snapDiagDir)) opt.SnapDiagnostics = new();
            }

            TakeoffResult result;
            if (inferred)
                result = snap.ReplayInferred(formulation, lines.Add, Configure);
            else
            {
                var stock = new TakeoffOptions {
                    CellFt = snap.Field.CellFt, Formulation = formulation, InferLevelProfile = false,
                };
                Configure(stock);
                result = snap.Replay(stock, lines.Add);
            }

            var appliedOptions = opt
                ?? throw new InvalidOperationException("replay policy did not supply takeoff options");

            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            string tsv = Path.Combine(outDir, $"rooms_{name}.tsv");
            File.WriteAllText(tsv, result.ToTsv());
            if (appliedOptions.SnapDiagnostics != null)
            {
                var payload = new {
                    level = snap.LevelName,
                    chains = appliedOptions.SnapDiagnostics.Select(d => new {
                        chainId = d.ChainId, labels = new[] { d.A, d.B },
                        lengthFt = d.LengthFt, snappedFt = d.SnappedFt, outcome = d.Outcome,
                        rawPoints = d.RawPoints, snappedPoints = d.SnappedPoints,
                        snappedRuns = d.SnappedRuns.Select(r => new {
                            lengthFt = r.LengthFt, rawPoints = r.RawPoints,
                            snappedStart = r.SnappedStart, snappedEnd = r.SnappedEnd,
                        }),
                    }),
                };
                File.WriteAllText(Path.Combine(snapDiagDir!, $"snap_{name}.json"),
                    JsonConvert.SerializeObject(payload, Formatting.Indented));
            }
            lines.Add($"[dump] {snap.LevelName}: rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
            File.WriteAllLines(Path.Combine(outDir, $"log_{name}.txt"), lines);
            foreach (string line in lines) TestContext.Out.WriteLine(line);
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
        if (bins.Count == 0) Assert.Ignore("no replay_*.bin captured yet");
        Directory.CreateDirectory(outDir);
        foreach (string bin in bins)
        {
            var snap = DetectSnapshot.Load(bin);
            var opt = TakeoffPolicy.InferLevelProfile(snap).Options;
            opt.Formulation = TakeoffFormulation.Partition;
            var obst = Detector.BuildObstruction(snap.Field, snap.SeedInk, snap.LevelElevation, opt, _ => { });
            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            PartitionFormulation.DumpDiagnostics(
                Path.Combine(outDir, $"diag_{name}.bin"), snap.Field, obst, snap.LevelElevation, opt);
            TestContext.Out.WriteLine($"[diag] {snap.LevelName} -> diag_{name}.bin");
        }
    }
}
