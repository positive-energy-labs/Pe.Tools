using System.IO.Compression;
using System.Runtime.CompilerServices;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     Runs <see cref="Solve.RunRails" /> on Duryee Level 1's five hand-drawn zones and project-a live, and
///     writes rails, network, openings, rooms and ink to <c>.artifacts/runs/rails/$PE_RAILS_RUN/data</c> (default w2) for
///     <c>eval/partition/network.py</c>. Probes are stubbed (floor at level, ceiling 9 ft up): Duryee has none captured
///     and project-a's recorded probes sit at the old solver's label points.
/// </summary>
[Explicit, Category("RailsRun")]
public sealed class RailsRun {
    private static string Out([CallerFilePath] string here = "") =>
        Directory.CreateDirectory(Path.Combine(Path.GetDirectoryName(here)!, "..", "..", ".artifacts", "runs", "rails", Environment.GetEnvironmentVariable("PE_RAILS_RUN") ?? "w2", "data")).FullName;

    private static IEnumerable<TestCaseData> Cases() {
        yield return new TestCaseData("project-a-live", null).SetName("project-a-live");
        foreach (var id in new[] { 6692266L, 6693266L, 6693828L, 6694146L, 7466453L })
            yield return new TestCaseData($"duryee-{id}", id).SetName($"duryee-{id}");
    }

    [TestCaseSource(nameof(Cases))]
    public void Run(string name, long? duryeeZone) {
        PartitionInput input;
        if (duryeeZone is { } id) {
            var level = Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-level-input.json");
            var locked = Path.Combine(PrivateFixtures.Dir("duryee/partition"), "duryee-locked.json");
            input = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(level))!;
            var zone = JArray.Parse(File.ReadAllText(locked)).Single(z => (long)z["ElementId"]! == id);
            double[] Flat(JToken ring) => ring.SelectMany(p => new[] { (double)p[0]!, (double)p[1]! }).ToArray();
            input = input with { ZoneLoops = [Flat(zone["Outer"]!), .. (zone["Holes"] as JArray ?? []).Select(Flat)] };
        } else {
            using var file = File.OpenRead(Path.Combine(PrivateFixtures.Dir("project-a/partition/live"), "partition-input.json.gz"));
            using var reader = new StreamReader(new GZipStream(file, CompressionMode.Decompress));
            input = JsonConvert.DeserializeObject<PartitionInput>(reader.ReadToEnd())!;
        }

        // As the bench does: the solver's own shape. Duryee's level capture carries the Astra session's locked hand
        // fills of these very zones, which RunRails now honours as locked rooms.
        input = input with { Proposals = [], Knobs = input.Knobs with { FramingRails = Environment.GetEnvironmentVariable("PE_FRAMING_RAILS") == "1" } };
        var stamp = input.Knee.Stamp;
        ProbeAnswer Probe(double x, double y) => new(stamp, input.Knee.Searched,
            new ProbeHit(input.Knee.Elements[0].Handle, 0, input.LevelZ), new ProbeHit(input.Knee.Elements[0].Handle, 9, input.LevelZ + 9), 20, 0);
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var answer = Solve.RunRails(input, Probe);
        var ms = sw.ElapsedMilliseconds;
        var rails = Rails.From(input);
        var net = Rails.Network(rails, input.ZoneLoops, OpeningEvidence.From(input));

        var zoneGeom = Solve.GeometryOf(input.ZoneLoops).EnvelopeInternal;
        zoneGeom.ExpandBy(6);
        bool Near(double[] p) => Enumerable.Range(0, p.Length / 2).Any(k => zoneGeom.Contains(p[2 * k], p[(2 * k) + 1]));
        var doc = new JObject {
            ["name"] = name,
            ["ms"] = ms,
            ["zone"] = JToken.FromObject(input.ZoneLoops),
            ["rails"] = JToken.FromObject(rails.Where(r => Near([.. r.A, .. r.B])).Select(r => new { r.A, r.B, r.ThicknessFt, r.Source })),
            ["segments"] = JToken.FromObject(net.Segments.Select(s => new { s.A, s.B, Kind = s.Kind.ToString(), s.Out })),
            ["openings"] = JToken.FromObject(net.Openings.Select(o => new { o.A, o.B, o.WidthFt, Kind = o.Kind.ToString(), o.DoorPieces, o.HeaderFraction, o.WallFraction })),
            ["rooms"] = JToken.FromObject(answer.Rooms.Select(r => new { r.Loop, r.Holes, Disposition = r.Disposition.ToString(), r.Reason, r.AreaSqft })),
            ["accounting"] = JToken.FromObject(answer.Accounting),
            ["ink"] = JToken.FromObject(input.Knee.Elements.SelectMany(e => e.Pieces.Where(Near).Select(p => new {
                c = e.Handle.Kind == PrimKind.Curve2D ? e.Handle.Layer : e.Handle.Category, p }))),
        };
        File.WriteAllText(Path.Combine(Out(), name + ".json"), doc.ToString(Formatting.None));
        TestContext.Out.WriteLine($"{name}: {answer.Rooms.Count} rooms, {net.Openings.Count} openings, {rails.Count} rails, {ms} ms");
    }
}
