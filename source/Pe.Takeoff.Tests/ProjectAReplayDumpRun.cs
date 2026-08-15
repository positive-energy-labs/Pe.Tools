using Pe.Revit.Takeoff;

using NUnit.Framework;

namespace Pe.Takeoff.Tests;

// Offline detection-loop driver: replays captured snapshots under the evidence-derived library
// policy and writes rooms_<level>.tsv files to $PE_TAKEOFF_REPLAY_OUT. No Revit is involved;
// the dump is read back through the review lane (eval/rhvac/review.ps1).
//
//   $env:PE_TAKEOFF_REPLAY_OUT = "<dir>"
//   $env:PE_TAKEOFF_REPLAY_FILTER = "replay_MAIN_LEVEL.bin;replay_ROOF_PLAN.bin" // optional
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

        string? seedSource = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEEDS");
        string? seedLevels = Environment.GetEnvironmentVariable("PE_TAKEOFF_SEED_LEVELS");
        string policy = Environment.GetEnvironmentVariable("PE_TAKEOFF_POLICY") ?? "Inferred";
        bool inferred = policy.Equals("Inferred", StringComparison.OrdinalIgnoreCase);
        if (!inferred && !policy.Equals("Stock", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("PE_TAKEOFF_POLICY must be Inferred or Stock");
        Directory.CreateDirectory(outDir);

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
            }

            TakeoffResult result;
            if (inferred)
                result = snap.ReplayInferred(lines.Add, Configure);
            else
            {
                var stock = new TakeoffOptions { CellFt = snap.Field.CellFt, InferLevelProfile = false };
                Configure(stock);
                result = snap.Replay(stock, lines.Add);
            }

            string name = string.Concat(snap.LevelName.Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));
            string tsv = Path.Combine(outDir, $"rooms_{name}.tsv");
            File.WriteAllText(tsv, result.ToTsv());
            lines.Add($"[dump] {snap.LevelName}: rooms={result.Rooms.Count} totalSqft={result.TotalSqft:F0} -> {tsv}");
            File.WriteAllLines(Path.Combine(outDir, $"log_{name}.txt"), lines);
            foreach (string line in lines) TestContext.Out.WriteLine(line);
        }
    }
}
