using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     Model health (ducts LEDGER 2026-10-29), one producer keyed by element and connector. Hand-built graphs, one
///     kind each; the Revit selectors are proved in Pe.Revit.Tests DuctSnapshotFromProofTests.
/// </summary>
[TestFixture]
public sealed class DuctHealthTests {
    private static readonly DuctHealthTolerances Defaults = DuctHealth.Tolerances(null);

    private static DuctConnector Port(int index, double[] at, long? to = null, int toPort = 0, string? cls = "SupplyAir", double[]? facing = null, double d = 8) =>
        new(index, "end", at, DuctShape.Round, $"{d}\"ø", d, null, null, null, "bidirectional", cls,
            to is { } id ? new DuctRef(id, toPort) : null, Facing: facing);

    private static DuctNode Node(long id, DuctNodeKind kind, double[] at, IReadOnlyList<DuctConnector> ports, params DuctFact[] facts) =>
        new(id, kind, kind.ToString(), "Fam", "Type", null, null, at, null, "SA 1", "Supply Air", ports, facts);

    private static DuctSegment Duct(long id, double[] a, double[] b, DuctConnector p0, DuctConnector p1, double d = 8,
        DuctSegmentKind kind = DuctSegmentKind.Duct, DuctRoughness? roughness = null, double? velocity = null) =>
        new(id, kind, DuctCurveKind.Line, "Round", DuctShape.Round, $"{d}\"ø", d, null, null,
            Math.Sqrt(Math.Pow(b[0] - a[0], 2) + Math.Pow(b[1] - a[1], 2) + Math.Pow(b[2] - a[2], 2)),
            [a, b], null, null, "SA 1", "Supply Air", roughness ?? new DuctRoughness(0.0003, DuctProvenance.Geometry),
            new DuctRevitValues(null, velocity, null, null), [p0, p1]);

    private static DuctFact Fact(string key, double value) => new(key, value, null, "", DuctProvenance.DesignerStated);

    [Test]
    public void Two_collinear_ducts_two_inches_apart_are_open_ends_and_near_misses_keyed_by_connector() {
        // 10 -> | 2 in | <- 11, both open at the gap, the far ends open too.
        const double gap = 2.0 / 12;
        var left = Duct(10, [0, 0, 0], [5, 0, 0], Port(0, [0, 0, 0]), Port(1, [5, 0, 0]));
        var right = Duct(11, [5 + gap, 0, 0], [10, 0, 0], Port(0, [5 + gap, 0, 0]), Port(1, [10, 0, 0]));

        var issues = DuctHealth.Assess([], [left, right], Defaults);

        Assert.That(issues.Select(i => i.Id), Is.EquivalentTo(new[] {
            "open-end:10:0", "open-end:10:1", "open-end:11:0", "open-end:11:1", "near-miss:10:1", "near-miss:11:0"
        }));
        var end = issues.Single(i => i.Id == "open-end:10:1");
        Assert.Multiple(() => {
            Assert.That(end.ElementId, Is.EqualTo(10));
            Assert.That(end.Connector, Is.EqualTo(1));
            var mate = end.Near!.Ports.Single(p => p.AutoJoin);
            Assert.That((mate.ElementId, mate.Connector), Is.EqualTo((11L, 0)));
            Assert.That(mate.GapIn, Is.EqualTo(2).Within(1e-9));
            Assert.That(mate.FacingDot, Is.EqualTo(-1).Within(1e-9));
            Assert.That(mate.Aligned, Is.True);
            // 11's far end is 5 ft away, outside the 36 in box.
            Assert.That(end.Near.Ports.Select(p => (p.ElementId, p.Connector)), Is.EquivalentTo(new[] { (11L, 0) }));
            Assert.That(end.Near.Bodies.Select(b => b.SegmentId), Is.EqualTo(new[] { 11L }));
        });
    }

    [Test]
    public void The_auto_join_gap_is_a_read_tolerance() {
        const double gap = 2.0 / 12;
        var left = Duct(10, [0, 0, 0], [5, 0, 0], Port(0, [0, 0, 0]), Port(1, [5, 0, 0]));
        var right = Duct(11, [5 + gap, 0, 0], [10, 0, 0], Port(0, [5 + gap, 0, 0]), Port(1, [10, 0, 0]));

        var tight = DuctHealth.Assess([], [left, right], new DuctHealthTolerances(36, 1));

        Assert.That(tight.Where(i => i.Kind == DuctIssueKind.NearMiss), Is.Empty, "2 in is past a 1 in auto-join gap");
        Assert.That(tight.Single(i => i.Id == "open-end:10:1").Near!.Ports.Single().AutoJoin, Is.False);
    }

    [Test]
    public void An_end_pointing_into_a_duct_side_lands_on_it_as_a_tap_face() {
        // Duct 20 runs along x; branch 21 comes down in y and stops 1 in short of 20's 8 in side.
        var main = Duct(20, [0, 0, 0], [10, 0, 0], Port(0, [0, 0, 0], 1), Port(1, [10, 0, 0], 2));
        var side = (8.0 / 2 + 1) / 12;
        var branch = Duct(21, [5, 3, 0], [5, side, 0], Port(0, [5, 3, 0], 3), Port(1, [5, side, 0]));

        var end = DuctHealth.Assess([], [main, branch], Defaults).Single(i => i.Id == "open-end:21:1");

        var tap = end.Near!.Faces.Single();
        Assert.Multiple(() => {
            Assert.That(tap.Kind, Is.EqualTo("tap"));
            Assert.That(tap.ElementId, Is.EqualTo(20));
            Assert.That(tap.Connector, Is.Null);
            Assert.That(tap.GapIn, Is.EqualTo(1).Within(1e-9));
            Assert.That(tap.AtFt, Is.EqualTo(5).Within(1e-9));
            var body = end.Near.Bodies.Single(b => b.SegmentId == 20);
            Assert.That(body.TapGapIn, Is.EqualTo(1).Within(1e-9));
            Assert.That(body.TapPoint![1], Is.EqualTo(4.0 / 12).Within(1e-9));
        });
    }

    [Test]
    public void Stub_loop_air_type_change_size_roughness_velocity_flow_and_drop_are_element_keyed() {
        // A ring of four ducts (one a 2 in stub), a terminal with no flow and an accessory with no drop hung off it,
        // a flex at the Revit default roughness, a 40 in duct, and a supply connector meeting a return one.
        var nodes = new List<DuctNode> {
            Node(30, DuctNodeKind.Terminal, [0, 20, 0], [Port(0, [0, 20, 0], 50, 1)]),
            Node(31, DuctNodeKind.Accessory, [0, 30, 0], [Port(0, [0, 30, 0], 51, 1), Port(1, [0, 31, 0], 52, 0, "ReturnAir")]),
            Node(32, DuctNodeKind.Terminal, [9, 9, 9], [Port(0, [9, 9, 9], 53, 1)], Fact(DuctNetwork.TerminalFlow, 100))
        };
        var segments = new List<DuctSegment> {
            Duct(40, [0, 0, 0], [10, 0, 0], Port(0, [0, 0, 0], 43, 1), Port(1, [10, 0, 0], 41, 0)),
            Duct(41, [10, 0, 0], [10, 10, 0], Port(0, [10, 0, 0], 40, 1), Port(1, [10, 10, 0], 42, 0)),
            Duct(42, [10, 10, 0], [0, 10, 0], Port(0, [10, 10, 0], 41, 1), Port(1, [0, 10, 0], 43, 0)),
            Duct(43, [0, 10, 0], [0, 10 - 1.0 / 6, 0], Port(0, [0, 10, 0], 42, 1), Port(1, [0, 0, 0], 40, 0)),
            Duct(50, [0, 21, 0], [0, 20, 0], Port(0, [0, 21, 0], 32, 0), Port(1, [0, 20, 0], 30, 0), kind: DuctSegmentKind.Flex,
                roughness: new DuctRoughness(0.0003, DuctProvenance.RevitDefault)),
            Duct(51, [0, 29, 0], [0, 30, 0], Port(0, [0, 29, 0], 32, 0), Port(1, [0, 30, 0], 31, 0), d: 40, velocity: 2500),
            Duct(52, [0, 31, 0], [0, 32, 0], Port(0, [0, 31, 0], 31, 1, "SupplyAir"), Port(1, [0, 32, 0], 99, 0))
        };

        var ids = DuctHealth.Assess(nodes, segments, Defaults).Select(i => i.Id).ToList();

        Assert.That(ids, Is.SupersetOf(new[] {
            "stub:43", "no-terminal-flow:30", "no-component-drop:31", "default-flex-roughness:50", "implausible-size:51",
            "high-velocity:51", "air-type-change:31:1", "air-type-change:52:0"
        }));
        Assert.That(ids.Count(i => i.StartsWith("loop:", StringComparison.Ordinal)), Is.EqualTo(1), "one ring, one closer");
        Assert.That(ids, Has.None.StartWith("no-terminal-flow:32"));
    }

    [Test]
    public void A_bounded_read_measures_against_context_but_reports_only_its_own_elements() {
        const double gap = 2.0 / 12;
        var left = Duct(10, [0, 0, 0], [5, 0, 0], Port(0, [0, 0, 0]), Port(1, [5, 0, 0]));
        var right = Duct(11, [5 + gap, 0, 0], [10, 0, 0], Port(0, [5 + gap, 0, 0]), Port(1, [10, 0, 0]));

        var issues = DuctHealth.Assess([], [left], Defaults, contextSegments: [right]);

        Assert.That(issues.Select(i => i.Id), Is.EquivalentTo(new[] { "open-end:10:0", "open-end:10:1", "near-miss:10:1" }));
    }

    [Test]
    public void Groups_index_the_issues_on_their_elements() {
        var a = DuctNetwork.Analyze([], [Duct(10, [0, 0, 0], [5, 0, 0], Port(0, [0, 0, 0]), Port(1, [5, 0, 0]))]);
        var issues = DuctHealth.Assess(a.Nodes, a.Segments, Defaults);
        Assert.That(DuctHealth.Index(a.Groups, a.Nodes, a.Segments, issues).Single().IssueIds,
            Is.EquivalentTo(new[] { "open-end:10:0", "open-end:10:1" }));
    }

    private const string Chadds = "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/tmp/ducts-sheet/chadds-snapshot-raw.json";

    /// <summary>
    ///     The retained Chadds whole-document read (2026-10-27, before the health field) given its health by this
    ///     producer, for the TypeScript sheet tests (chadds-snapshot-health.json beside it). Explicit: it writes a
    ///     gitignored fixture and needs the retained file.
    /// </summary>
    [Test, Explicit("writes the retained Chadds health fixture")]
    public void Write_retained_chadds_health() {
        if (!File.Exists(Chadds)) Assert.Ignore($"{Chadds} is absent");
        var settings = new JsonSerializerSettings {
            ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false } },
            Converters = [new StringEnumConverter(new CamelCaseNamingStrategy())]
        };
        var serializer = JsonSerializer.Create(settings);
        var root = JObject.Parse(File.ReadAllText(Chadds).TrimStart('\uFEFF'));
        var result = (JObject)root["result"]!;
        var nodes = result["nodes"]!.ToObject<List<DuctNode>>(serializer)!;
        var segments = result["segments"]!.ToObject<List<DuctSegment>>(serializer)!;
        var groups = result["groups"]!.ToObject<List<DuctGroup>>(serializer)!;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        var issues = DuctHealth.Assess(nodes, segments, Defaults);
        TestContext.Progress.WriteLine($"assessed {nodes.Count + segments.Count} elements in {clock.ElapsedMilliseconds} ms: {issues.Count} issues");
        var write = JsonSerializer.Create(new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = settings.ContractResolver,
            Converters = [new StringEnumConverter()]
        });
        result["issues"] = JArray.FromObject(issues, write);
        result["groups"] = JArray.FromObject(DuctHealth.Index(groups, nodes, segments, issues), write);
        result["tolerances"] = JObject.FromObject(Defaults, write);
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(Chadds)!, "chadds-snapshot-health.json"), root.ToString(Formatting.None));
    }

    private static string SheetFixtures([CallerFilePath] string source = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(source)!, "..", "..", "..",
            "ts", "packages", "ducts-domain", "src", "sheet", "fixtures"));

    /// <summary>
    ///     The TypeScript sheet's synthetic graphs (recorded by its tests to synthetic-health-inputs.json) given their
    ///     health by this producer, the only one (ts sheet/health.fixture.ts). PE_WRITE_FIXTURES=1 rewrites
    ///     synthetic-health.json; otherwise every recorded graph must still assess to what is on disk.
    /// </summary>
    [Test]
    public void Synthetic_sheet_health() {
        var inputs = Path.Combine(SheetFixtures(), "synthetic-health-inputs.json");
        var output = Path.Combine(SheetFixtures(), "synthetic-health.json");
        Assert.That(File.Exists(inputs), $"missing {inputs}");
        var read = new JsonSerializerSettings {
            ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false } },
            Converters = [new StringEnumConverter(new CamelCaseNamingStrategy())]
        };
        var serializer = JsonSerializer.Create(read);
        var write = JsonSerializer.Create(new JsonSerializerSettings {
            NullValueHandling = NullValueHandling.Ignore,
            ContractResolver = read.ContractResolver,
            Converters = [new StringEnumConverter()]
        });
        var result = new JObject();
        foreach (var (key, value) in JObject.Parse(File.ReadAllText(inputs))) {
            var graph = (JObject)value!;
            var t = graph["tolerances"] as JObject;
            var tolerances = new DuctHealthTolerances(
                t?["candidateBoxIn"]?.Value<double>() ?? DuctHealth.CandidateBoxIn,
                t?["autoJoinGapIn"]?.Value<double>() ?? DuctHealth.AutoJoinGapIn);
            var issues = DuctHealth.Assess(
                graph["nodes"]!.ToObject<List<DuctNode>>(serializer)!,
                graph["segments"]!.ToObject<List<DuctSegment>>(serializer)!,
                tolerances);
            result[key] = new JObject {
                ["issues"] = JArray.FromObject(issues, write),
                ["tolerances"] = JObject.FromObject(tolerances, write)
            };
        }
        if (Environment.GetEnvironmentVariable("PE_WRITE_FIXTURES") == "1")
            File.WriteAllText(output, result.ToString(Formatting.Indented).Replace("\r\n", "\n") + "\n");
        Assert.That(File.Exists(output), $"missing {output}; run with PE_WRITE_FIXTURES=1");
        Assert.That(JToken.DeepEquals(JToken.Parse(File.ReadAllText(output)), result), Is.True,
            $"{output} drifted from DuctHealth; run with PE_WRITE_FIXTURES=1");
    }
}
