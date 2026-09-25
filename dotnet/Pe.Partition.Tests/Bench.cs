using System.Diagnostics;
using System.IO.Compression;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     The verification bench (rails brief, W3). Runs the current solver over the five fixtures,
///     writes <c>answer.json</c> and <c>ink.json</c> per fixture under
///     <c>.artifacts/runs/bench/&lt;utc stamp&gt;/&lt;fixture&gt;/</c>, then hands the run to
///     <c>eval/partition/metrics.py</c> (metrics.json, tables, delta against the previous run) and
///     <c>eval/partition/render.py</c> (one PNG per fixture). Explicit: it is a bench, not a gate.
///     <para>
///         Probes are stubbed (floor at the level, ceiling 9 ft over it) so dispositions come from
///         geometry alone; the bench judges shape, never floors. Duryee is the five hand-drawn zones
///         of Mechanical Zoning Plan - Level 1, solved one at a time and concatenated.
///     </para>
/// </summary>
[TestFixture, Explicit("bench: writes .artifacts/runs/bench and needs python with PIL")]
public sealed class Bench {
    private static readonly Handle Stub = new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);

    private static string RepoRoot {
        get {
            var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
            while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx"))) dir = dir.Parent;
            return dir?.FullName ?? throw new InvalidOperationException("Pe.Tools.slnx not found above the test directory");
        }
    }

    // Duryee Level 1: the doors capture (the input the w11 session solved) and the five hand-drawn zones.
    private static string DuryeeInput => Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-level-input.json");
    private static string DuryeeZones => Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-locked.json");

    // PE_FRAMING_RAILS=0 turns Knobs.FramingRails off for every fixture; the run directory says which.
    private static bool FramingOn => Environment.GetEnvironmentVariable("PE_FRAMING_RAILS") != "0";

    [Test]
    public void RailsSolve() {
        var run = Path.Combine(RepoRoot, ".artifacts", "runs", "bench", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + (FramingOn ? "-rails" : "-rails-noframing"));
        Directory.CreateDirectory(run);
        foreach (var (name, inputs) in Fixtures()) {
            var dir = Path.Combine(run, name);
            Directory.CreateDirectory(dir);
            var answers = new List<PartitionAnswer>();
            foreach (var captured in inputs) {
                // The bench measures the solver's own shape. Architect proposals are adopted, not solved, so they
                // are stripped; the Duryee session ran with none (zone-0d5e3ccb-inputs.json) and this matches it.
                var input = captured with { Proposals = [], Knobs = captured.Knobs with { FramingRails = FramingOn } };
                var z = input.LevelZ;
                ProbeAnswer Probe(double x, double y) => new(input.Knee.Stamp, input.Knee.Searched,
                    new ProbeHit(Stub, 0.0, z), new ProbeHit(Stub, 9.0, z + 9.0), 200.0, 0.0);
                answers.Add(Solve.RunRails(input, Probe));
            }
            File.WriteAllText(Path.Combine(dir, "answer.json"), JsonConvert.SerializeObject(new {
                Zones = inputs.Select(i => i.ZoneLoops).ToArray(),
                Rooms = answers.SelectMany((a, zi) => a.Rooms.Select(r => new { Zone = zi, r.Index, Disposition = r.Disposition.ToString(), r.Reason, r.AreaSqft, r.Loop, r.Holes, r.InkBacked })).ToArray(),
                Accounting = answers.Select(a => a.Accounting).ToArray(),
                Ms = answers.Sum(a => a.Ms),
            }));
            // Ink is the knee band's pieces (flat convex x,y polygons), the evidence the solver saw.
            File.WriteAllText(Path.Combine(dir, "ink.json"), JsonConvert.SerializeObject(new {
                Knee = inputs[0].Knee.Elements.SelectMany(e => e.Pieces).ToArray(),
                Header = inputs[0].Header.Elements.SelectMany(e => e.Pieces).ToArray(),
            }));
            var rails = Rails.From(inputs[0] with { Knobs = inputs[0].Knobs with { FramingRails = FramingOn } });
            TestContext.Out.WriteLine($"{name}: {answers.Sum(a => a.Rooms.Count)} rooms in {answers.Sum(a => a.Ms):F0} ms, "
                + $"{rails.Count} rails ({rails.Count(r => r.Source == Rails.Framing)} framing)");
        }
        Python("metrics.py", run);
        Python("render.py", run);
        TestContext.Out.WriteLine(run);
    }

    private static IEnumerable<(string Name, PartitionInput[] Inputs)> Fixtures() {
        yield return ("project-a-live", [Gz("project-a/partition/live")]);
        yield return ("project-a-main-09", [Main09()]);
        yield return ("project-c-live", [Gz("project-c/partition/live")]);
        yield return ("project-c-level2", [Gz("project-c/partition/level2")]);
        yield return ("duryee-level1", Duryee());
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

    private static PartitionInput[] Duryee() {
        var level = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(DuryeeInput))!;
        // The five hand fills (the 100 sf Pantry is a room, not a zone). Solved as zones: a person's zone edge is a wall.
        return JArray.Parse(File.ReadAllText(DuryeeZones))
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
