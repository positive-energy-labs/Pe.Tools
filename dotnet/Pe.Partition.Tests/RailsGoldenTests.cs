using System.IO.Compression;
using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using Pe.Revit.Partition;
using Pe.Revit.Space;

namespace Pe.Partition.Tests;

/// <summary>
///     Behaviour lock on <see cref="Solve.RunRails" />: every Room field at full precision, hashed per fixture against
///     <c>golden/rails-solve.sha256</c> (a hash, because the fixtures are private). Inputs are the bench's (Duryee's doors
///     capture over its five zones, project-a live, main-09; proposals stripped, framing on), plus Duryee and project-a
///     live rerun with every other accepted room locked and an architect Room over the first locked one, so the locked-scrap,
///     adopted and contested paths are held too. On a mismatch the keys
///     are written to <c>.artifacts/runs/golden/&lt;fixture&gt;.txt</c> for diffing. PE_GOLDEN_WRITE=1 rewrites the file.
/// </summary>
public sealed class RailsGoldenTests {
    private static readonly Handle Stub = new("stub", 0, "", null, "Detail Items", PrimKind.Solid, null, null);

    private static string Here([CallerFilePath] string here = "") => Path.GetDirectoryName(here)!;

    private static string Expected => Path.Combine(Here(), "golden", "rails-solve.sha256");

    private static IEnumerable<TestCaseData> Fixtures() {
        foreach (var name in new[] { "duryee-level1", "duryee-level1-locked", "project-a-live", "project-a-live-locked", "project-a-main-09" })
            yield return new TestCaseData(name).SetName(name);
    }

    [TestCaseSource(nameof(Fixtures))]
    public void Rooms_are_unchanged(string name) {
        var keys = new StringBuilder();
        foreach (var (zi, bare) in Inputs(name).Select((x, i) => (i, x))) {
            var input = bare;
            if (name.EndsWith("-locked", StringComparison.Ordinal)) {
                var locked = Run(bare).Rooms.Where(r => r.Disposition == Disposition.Accepted).Where((_, k) => k % 2 == 0)
                    .Select(r => new RoomProposal(RoomProposal.LockedPrefix + r.Index, $"R{r.Index}", "", [r.Loop, .. r.Holes ?? []])).ToList();
                input = bare with { Proposals = [.. locked, .. locked.Take(1).Select(p => p with { SourceKey = "arch|0" })] };
            }
            var answer = Run(input);
            foreach (var r in answer.Rooms) keys.Append(zi).Append(' ').AppendLine(Key(r));
            var a = answer.Accounting;
            keys.AppendLine($"{zi} accounting {R(a.ZoneSqft)} {R(a.Accepted)} {R(a.Held)} {R(a.Void)} {R(a.Excluded)}");
        }
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(keys.ToString())));
        var lines = File.Exists(Expected) ? File.ReadAllLines(Expected).Where(l => l.Length > 0).ToList() : [];
        if (Environment.GetEnvironmentVariable("PE_GOLDEN_WRITE") == "1") {
            lines = lines.Where(l => l.Split(' ')[0] != name).Append($"{name} {hash}").Order(StringComparer.Ordinal).ToList();
            File.WriteAllLines(Expected, lines);
        }
        var want = lines.Select(l => l.Split(' ')).SingleOrDefault(p => p[0] == name)?[1];
        if (want != hash) {
            var dir = Directory.CreateDirectory(Path.Combine(Here(), "..", "..", ".artifacts", "runs", "golden")).FullName;
            File.WriteAllText(Path.Combine(dir, name + ".txt"), keys.ToString());
            TestContext.Out.WriteLine($"keys written to {Path.Combine(dir, name + ".txt")}");
        }
        Assert.That(hash, Is.EqualTo(want), $"{name}: rails solve output changed");
    }

    /// <summary>Layer 1's trace on a Duryee zone: rails, a door-scale opening, a face per room; it reads back as the wire contract.</summary>
    [Test]
    public void Duryee_trace_carries_layer_one() {
        var answer = Run(Inputs("duryee-level1").First());
        var trace = answer.Trace;
        TestContext.Out.WriteLine($"rails {trace.Rails.Count} segments {trace.Segments.Count} openings "
            + string.Join(' ', trace.Openings.GroupBy(o => o.Kind).Select(g => $"{g.Key}={g.Count()}")) + $" faces {trace.Faces.Count}");
        Assert.That(trace.Rails, Is.Not.Empty);
        Assert.That(trace.Openings.Count(o => o.Kind is SegKind.Door or SegKind.Headed or SegKind.Cased), Is.GreaterThan(0));
        Assert.That(trace.Faces.Select(f => f.Index), Is.EqualTo(answer.Rooms.Select(r => r.Index)));

        var settings = new JsonSerializerSettings {
            ContractResolver = new Newtonsoft.Json.Serialization.CamelCasePropertyNamesContractResolver(),
            Converters = [new Newtonsoft.Json.Converters.StringEnumConverter()],
        };
        var wire = JsonConvert.DeserializeObject<Pe.Shared.RevitData.Takeoffs.RoomsZoneTrace>(JsonConvert.SerializeObject(
            new { ZoneGuid = Guid.Empty, Label = "z", trace, answer.Accounting }, settings), settings)!;
        Assert.That(JsonConvert.SerializeObject(wire.Trace, settings), Is.EqualTo(JsonConvert.SerializeObject(trace, settings)));
        Assert.That(wire.Accounting.ZoneSqft, Is.EqualTo(answer.Accounting.ZoneSqft));
    }

    private static PartitionAnswer Run(PartitionInput input) =>
        Solve.RunRails(input, (_, _) => new ProbeAnswer(input.Knee.Stamp, input.Knee.Searched,
            new ProbeHit(Stub, 0.0, input.LevelZ), new ProbeHit(Stub, 9.0, input.LevelZ + 9.0), 200.0, 0.0));

    private static string R(double v) => v.ToString("R", System.Globalization.CultureInfo.InvariantCulture);

    private static string R(double? v) => v is { } d ? R(d) : "-";

    private static string Ring(IEnumerable<double> xy) => string.Join(',', xy.Select(R));

    private static string Key(Room r) =>
        $"{r.Index} {r.Disposition} {r.Reason ?? "-"} area={R(r.AreaSqft)} label={R(r.LabelX)},{R(r.LabelY)} ink={R(r.InkBacked)} "
        + $"floor={R(r.FloorZ)} ceiling={R(r.CeilingZ)} proposal={r.Proposal?.SourceKey ?? "-"} "
        + $"shared=[{string.Join(';', r.Shared.Select(s => $"{s.Other}:{R(s.LengthFt)}:{R(s.Support)}"))}] "
        + $"loop=[{Ring(r.Loop)}] holes=[{string.Join(';', (r.Holes ?? []).Select(Ring))}]";

    private static IEnumerable<PartitionInput> Inputs(string name) {
        IEnumerable<PartitionInput> raw = name switch {
            "duryee-level1" or "duryee-level1-locked" => Duryee(),
            "project-a-live" or "project-a-live-locked" => [Gz("project-a/partition/live")],
            "project-a-main-09" => [Main09()],
            _ => throw new ArgumentException(name),
        };
        return raw.Select(i => i with { Proposals = [], Knobs = i.Knobs with { FramingRails = true } });
    }

    private static PartitionInput Gz(string fixture) {
        using var file = File.OpenRead(Path.Combine(PrivateFixtures.Dir(fixture), "partition-input.json.gz"));
        using var reader = new StreamReader(new GZipStream(file, CompressionMode.Decompress));
        return JsonConvert.DeserializeObject<PartitionInput>(reader.ReadToEnd())!;
    }

    private static PartitionInput Main09() {
        var dir = PrivateFixtures.Dir("project-a/partition/main-09");
        SliceAnswer Load(string f) { using var fs = File.OpenRead(Path.Combine(dir, f)); return SliceJson.Read(fs); }
        var knee = Load("knee.json");
        var zone = JObject.Parse(File.ReadAllText(Path.Combine(dir, "zone.json")));
        return new PartitionInput(knee, Load("header.json"), [zone["loop"]!.Select(v => (double)v!).ToArray()], (double)zone["levelZ"]!,
            Knobs.Default, [knee.Stamp.Resolved], "historical synthetic fixture", []);
    }

    // Duryee Level 1's doors capture over the five hand-drawn zones, as the bench solves them.
    private static IEnumerable<PartitionInput> Duryee() {
        var dir = PrivateFixtures.Dir("duryee/partition");
        var level = JsonConvert.DeserializeObject<PartitionInput>(File.ReadAllText(Path.Combine(dir, "duryee-level-input.json")))!;
        return JArray.Parse(File.ReadAllText(Path.Combine(dir, "duryee-locked.json")))
            .Where(r => (double)r["Sqft"]! > 200)
            .Select(r => level with { ZoneLoops = [r["Outer"]!.SelectMany(p => new[] { (double)p[0]!, (double)p[1]! }).ToArray()] })
            .ToList();
    }
}
