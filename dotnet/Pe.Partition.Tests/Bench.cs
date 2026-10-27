using System.Diagnostics;
using System.IO.Compression;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     The verification bench (rails brief, W3). Runs the current solver over the available fixtures,
///     writes <c>answer.json</c> and <c>ink.json</c> per fixture under
///     <c>.artifacts/runs/bench/&lt;utc stamp&gt;/&lt;fixture&gt;/</c>, then hands the run to
///     <c>eval/partition/metrics.py</c> (metrics.json, tables, delta against the previous run) and
///     <c>eval/partition/render.py</c> (one PNG per fixture). Explicit: it is a bench, not a gate.
///     <para>
///         Probes replay a session recording (<see cref="RecordedProbes" />) when the fixture has one, else
///         they are stubbed (floor at the level, ceiling 9 ft over it). Project D is the five hand-drawn zones
///         of Mechanical Zoning Plan - Level 1, solved one at a time and concatenated. Set
///         PE_BENCH_PROPOSALS=1 to retain captured proposals and PE_BENCH_FIXTURES=a,b to select fixtures;
///         detail.json retains the full answers and traces, failure.txt a fixture's solve exception.
///     </para>
/// </summary>
[TestFixture, Explicit("bench: writes .artifacts/runs/bench and needs python with PIL")]
public sealed class Bench {
    private static string RepoRoot {
        get {
            var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("Pe.Tools.slnx not found above the test directory");
        }
    }

    // Project D Level 1: the doors capture (the input the w11 session solved) and the five hand-drawn zones.
    private static string ProjectDInput => Path.Combine(PrivateFixtures.Dir("project-d/partition"), "project-d-level-input.json");
    private static string ProjectDZones => Path.Combine(PrivateFixtures.Dir("project-d/partition"), "project-d-locked.json");

    // PE_FRAMING_RAILS=0 turns Knobs.FramingRails off for every fixture; the run directory says which.
    private static bool FramingOn => Environment.GetEnvironmentVariable("PE_FRAMING_RAILS") != "0";
    private static bool KeepProposals => Environment.GetEnvironmentVariable("PE_BENCH_PROPOSALS") == "1";

    [Test]
    public void RailsSolve() {
        var run = Path.Combine(RepoRoot, ".artifacts", "runs", "bench", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + (FramingOn ? "-rails" : "-rails-noframing") + (KeepProposals ? "-proposals" : ""));
        Directory.CreateDirectory(run);
        var failures = new List<string>();
        var selected = Environment.GetEnvironmentVariable("PE_BENCH_FIXTURES")?.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];
        var fixtures = Fixtures().Where(f => selected.Length == 0 || selected.Contains(f.Name, StringComparer.Ordinal)).ToList();
        Assert.That(fixtures, Is.Not.Empty, "PE_BENCH_FIXTURES matched no fixtures");
        foreach (var (name, inputs, probeDir) in fixtures) {
            var probes = RecordedProbes.For(probeDir);
            var dir = Path.Combine(run, name);
            Directory.CreateDirectory(dir);
            var answers = new List<PartitionAnswer>();
            try {
                foreach (var captured in inputs) {
                    // Default: measure the rail solver alone. Architect proposals are adopted, not solved, so they are
                    // stripped; the Project D session ran with none (zone-0d5e3ccb-inputs.json) and this matches it.
                    // PE_BENCH_PROPOSALS=1 also exercises adoption and the scraps between proposals and rails.
                    var input = captured with { Proposals = KeepProposals ? captured.Proposals : [], Knobs = captured.Knobs with { FramingRails = FramingOn } };
                    answers.Add(Solve.RunRails(input, probes.For(input)));
                }
            } catch (Exception e) {
                // Covers solving only; fixture enumeration and loading still fail the run at once.
                File.WriteAllText(Path.Combine(dir, "failure.txt"), $"{name}, zone index {answers.Count}\n{e}");
                failures.Add($"{name}, zone index {answers.Count}: {e.Message}");
                continue;
            }
            File.WriteAllText(Path.Combine(dir, "answer.json"), JsonConvert.SerializeObject(new {
                Zones = inputs.Select(i => i.ZoneLoops).ToArray(),
                Rooms = answers.SelectMany((a, zi) => a.Rooms.Select(r => new { Zone = zi, r.Index, Disposition = r.Disposition.ToString(), r.Reason, r.AreaSqft, r.Loop, r.Holes, r.InkBacked })).ToArray(),
                Accounting = answers.Select(a => a.Accounting).ToArray(),
                Ms = answers.Sum(a => a.Ms),
            }));
            File.WriteAllText(Path.Combine(dir, "detail.json"), JsonConvert.SerializeObject(answers));
            // Ink is the knee band's pieces (flat convex x,y polygons), the evidence the solver saw.
            File.WriteAllText(Path.Combine(dir, "ink.json"), JsonConvert.SerializeObject(new {
                Knee = inputs[0].Knee.Elements.SelectMany(e => e.Pieces).ToArray(),
                Header = inputs[0].Header.Elements.SelectMany(e => e.Pieces).ToArray(),
            }));
            var rails = Rails.From(inputs[0] with { Knobs = inputs[0].Knobs with { FramingRails = FramingOn } });
            TestContext.Out.WriteLine($"{name}: {answers.Sum(a => a.Rooms.Count)} rooms in {answers.Sum(a => a.Ms):F0} ms, "
                + $"{rails.Count} rails ({rails.Count(r => r.Source == Rails.Framing)} framing), "
                + (probes.Recorded ? $"probes {probes.Hits} recorded, {probes.Misses} stubbed" : "probes stubbed"));
        }
        Python("metrics.py", run);
        Python("render.py", run);
        TestContext.Out.WriteLine(run);
        Assert.That(failures, Is.Empty, string.Join("\n", failures));
    }

    private static IEnumerable<(string Name, PartitionInput[] Inputs, string? ProbeDir)> Fixtures() {
        yield return ("project-a-live", [Gz("project-a/partition/live")], "project-a/partition/live");
        yield return ("project-a-main-09", [Main09()], null);
        // Main Level#09 recaptured 2026-09-25 from the Project A (Recovery) file with Enclosure.Default (Doors included).
        // That file links the March IFC and 03.12 DWG, not the 07.28 set main-09 came from: a different model state.
        yield return ("project-a-main-09-doors", [Gz("project-a/partition/main-09-doors")], "project-a/partition/main-09-doors");
        yield return ("project-c-live", [Gz("project-c/partition/live")], "project-c/partition/live");
        yield return ("project-c-level2", [Gz("project-c/partition/level2")], null);
        yield return ("project-d-level1", ProjectD(), "project-d/partition");
        // Per-level captures with their zones (<model>/partition/<level>/zones.json), discovered on disk so no model
        // name is written here; the run names them by their private directories, which stay under .artifacts.
        if (!Directory.Exists(PrivateFixtures.Root)) yield break;
        foreach (var level in Directory.GetDirectories(PrivateFixtures.Root).SelectMany(m => Directory.Exists(Path.Combine(m, "partition"))
                     ? Directory.GetDirectories(Path.Combine(m, "partition")) : []).Where(l => File.Exists(Path.Combine(l, "zones.json"))).Order()) {
            var model = Path.GetFileName(Path.GetDirectoryName(Path.GetDirectoryName(level)))!;
            var captured = Gz($"{model}/partition/{Path.GetFileName(level)}");
            var inputs = JArray.Parse(File.ReadAllText(Path.Combine(level, "zones.json")))
                .Select(z => captured with { ZoneLoops = z["Loops"]!.ToObject<double[][]>()! }).ToArray();
            yield return ($"{model}-{Path.GetFileName(level)}", inputs, null);
        }
    }

    private static PartitionInput Gz(string fixture) {
        using var file = File.OpenRead(Path.Combine(PrivateFixtures.Dir(fixture), "partition-input.json.gz"));
        using var gzip = new GZipStream(file, CompressionMode.Decompress);
        using var reader = new StreamReader(gzip);
        return JsonConvert.DeserializeObject<PartitionInput>(reader.ReadToEnd())!;
    }

    private static PartitionInput Main09() {
        var dir = PrivateFixtures.Dir("project-a/partition/main-09");
        SliceAnswer Load(string name) { using var fs = File.OpenRead(Path.Combine(dir, name)); return SliceJson.Read(fs); }
        var knee = Load("knee.json");
        var zone = JObject.Parse(File.ReadAllText(Path.Combine(dir, "zone.json")));
        return new PartitionInput(knee, Load("header.json"), [zone["loop"]!.Select(v => (double)v!).ToArray()], (double)zone["levelZ"]!,
            Knobs.Default, [knee.Stamp.Resolved], "historical synthetic fixture", []);
    }

    private static PartitionInput[] ProjectD() {
        var level = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(ProjectDInput))!;
        // The five hand fills (the 100 sf Pantry is a room, not a zone). Solved as zones: a person's zone edge is a wall.
        return JArray.Parse(File.ReadAllText(ProjectDZones))
            .Where(r => (double)r["Sqft"]! > 200)
            .Select(r => level with { ZoneLoops = [r["Outer"]!.SelectMany(p => new[] { (double)p[0]!, (double)p[1]! }).ToArray()] })
            .ToArray();
    }

    private static void Python(string script, string run) {
        var p = Process.Start(new ProcessStartInfo("python", $"\"{Path.Combine(RepoRoot, "eval", "partition", script)}\" \"{run}\"") {
            RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false,
        })!;
        TestContext.Out.Write(p.StandardOutput.ReadToEnd());
        var err = p.StandardError.ReadToEnd();
        p.WaitForExit();
        Assert.That(p.ExitCode, Is.EqualTo(0), $"{script} failed:\n{err}");
    }
}
