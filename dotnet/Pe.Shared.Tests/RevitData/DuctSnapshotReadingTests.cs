using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

[TestFixture]
public sealed class DuctSnapshotReadingTests {
    private static readonly JsonSerializerSettings Wire = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false } },
        Converters = [new StringEnumConverter()]
    };
    private static string Json(object value) => JsonConvert.SerializeObject(value, Wire);
    private static int Bytes(object value) => Encoding.UTF8.GetByteCount(Json(value));

    [Test]
    public void Index_omits_elements_and_pressure_and_group_solves_only_its_graph_even_with_a_shared_root() {
        var first = DuctPressureBackendTests.Network();
        var fan = first.Nodes.Single(n => n.Kind == DuctNodeKind.Equipment);
        var secondTerminal = first.Nodes.Single(n => n.Kind == DuctNodeKind.Terminal) with {
            Id = 3, Connectors = [first.Nodes[1].Connectors[0] with { ConnectedTo = new(20, 1) }]
        };
        var secondSegment = first.Segments[0] with { Id = 20, Polyline = [[20, 0, 0], [30, 0, 0]], Connectors = [
            first.Segments[0].Connectors[0] with { ConnectedTo = new(fan.Id, 1) },
            first.Segments[0].Connectors[1] with { ConnectedTo = new(3, 0) }]
        };
        fan = fan with { Connectors = [..fan.Connectors, fan.Connectors[0] with { Index = 1, ConnectedTo = new(20, 0) }] };
        var analysis = DuctNetwork.Analyze([fan, first.Nodes[1], secondTerminal], [first.Segments[0], secondSegment]);
        var capture = first with { Nodes = analysis.Nodes, Segments = analysis.Segments, Groups = analysis.Groups,
            Issues = analysis.Issues, Flows = analysis.Flows };
        var index = DuctSnapshotReader.Read(capture, new());
        var wire = JObject.Parse(Json(index));
        Assert.Multiple(() => {
            Assert.That(index.Groups, Has.Count.EqualTo(2));
            foreach (var name in new[] { "nodes", "segments", "flows", "issues", "pressure", "context" })
                Assert.That(wire.ContainsKey(name), Is.False, name);
            Assert.That(index.Groups.Sum(g => g.DesignCfm), Is.EqualTo(400));
            Assert.That(index.Groups.All(g => g.RootNames.Single() == "Fan"), Is.True);
        });
        var group = capture.Groups.Single(g => g.Id == "g2");
        var open = capture.Issues.Single(i => i.Kind == DuctIssueKind.OpenEnd);
        var staged = new DuctStagedAssumptions(7, new Dictionary<string, DuctWorkAssumption> {
            [open.Id] = new(DuctAssumptionKind.Verdict, Verdict: OpenEndVerdict.Capped),
            ["fan-static:1"] = new(DuctAssumptionKind.FanStatic, InWg: .5)
        });
        var read = DuctSnapshotReader.Read(capture, new() { Group = group.Id, Context = true, Assumptions = staged });
        Assert.Multiple(() => {
            Assert.That(read.Segments!.Select(s => s.Id), Is.EqualTo(new[] { 10L }));
            Assert.That(read.Nodes!.Select(n => n.Id), Is.EquivalentTo(new[] { 1L, 2L }));
            Assert.That(read.Issues!.All(i => i.GroupId == group.Id), Is.True);
            Assert.That(read.Pressure!.Groups.Select(g => g.GroupId), Is.EqualTo(new[] { group.Id }));
            Assert.That(read.Pressure.Segments.All(s => s.SegmentId == 10), Is.True);
            Assert.That(read.Pressure.AssumptionRevision, Is.EqualTo(7));
            Assert.That(read.AssumptionRevision, Is.EqualTo(7));
            Assert.That(read.Groups.Single(g => g.Id == group.Id).IssueCounts.Single(c => c.Kind == DuctIssueKind.OpenEnd).Open, Is.Zero);
            Assert.That(read.Context!.Single().Polylines.Single().First(), Is.EqualTo(new[] { 20d, 0, 0 }));
            Assert.That(JObject.Parse(Json(read.Context.Single())).Properties().Select(p => p.Name), Is.EqualTo(new[] { "polylines" }));
            Assert.Throws<ArgumentException>(() => DuctSnapshotReader.Read(capture, new() { Group = "missing" }));
        });
        // Document Work can include a valid judgment for the unselected group.
        var sibling = DuctSnapshotReader.Read(capture, new() { Group = "g3", Assumptions = staged });
        Assert.That(sibling.Pressure!.Groups.Select(g => g.GroupId), Is.EqualTo(new[] { "g3" }));
        Assert.That(DuctSnapshotReader.Read(capture, new() { Context = true }).Context!.Single().Polylines, Has.Count.EqualTo(2));
        var ungrouped = capture with { Segments = [..capture.Segments, secondSegment with { Id = 30, GroupId = null }] };
        Assert.That(DuctSnapshotReader.Read(ungrouped, new() { Context = true }).Context!.Single().Polylines, Has.Count.EqualTo(3));
    }

    [Test]
    public void Private_fixture_sizes_use_the_production_shaper_for_index_every_group_and_context() {
        var path = Environment.GetEnvironmentVariable("PE_DUCTS_SOLVER_FIXTURE");
        if (path is null || !File.Exists(path)) Assert.Ignore("Set PE_DUCTS_SOLVER_FIXTURE to the private capture.");
        var snapshot = DuctPressureSolver.ReadSnapshot(File.ReadAllText(path!));
        // Match the native evidence fields using only data retained by the saved capture. Radius stays unknown.
        snapshot = snapshot with { Nodes = snapshot.Nodes.Select(n => n.Kind is DuctNodeKind.Fitting or DuctNodeKind.Cap
            ? n with { FittingGeometry = DuctFittingGeometry.Classify(n.PartType, n.Family, n.Type, n.Connectors,
                new(n.Facts.FirstOrDefault(f => f.Key == "angle")?.Value, DuctProvenance.Geometry, "saved angle fact"),
                new(null, DuctProvenance.Geometry, "Center Radius absent from saved fixture"),
                new(null, DuctProvenance.Geometry, "Duct Radius absent from saved fixture")) } : n).ToArray() };
        var index = DuctSnapshotReader.Read(snapshot, new());
        var context = DuctSnapshotReader.Read(snapshot, new() { Context = true });
        var groups = snapshot.Groups.Select(g => {
            var read = DuctSnapshotReader.Read(snapshot, new() { Group = g.Id, Context = true });
            Assert.That(read.Pressure!.Groups.All(p => p.GroupId == g.Id), Is.True, g.Id);
            return new { g.Id, Bytes = Bytes(read with { Context = null }), WithContextBytes = Bytes(read),
                ContextBytes = Bytes(read.Context!), Elements = read.Nodes!.Count + read.Segments!.Count };
        }).OrderByDescending(g => g.Bytes).ToArray();
        var summary = new {
            FixtureSha256 = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(path!))),
            IndexBytes = Bytes(index), IndexWithContextBytes = Bytes(context), ContextBytes = Bytes(context.Context!),
            SmallestGroupBytes = groups.Min(g => g.Bytes), MedianGroupBytes = groups[groups.Length / 2].Bytes,
            Largest = groups[0], Groups = groups,
            Caveat = "Saved capture has no native per-element radius or friction-method identity. These are estimates, without the host envelope."
        };
        if (Environment.GetEnvironmentVariable("PE_DUCTS_SOLVER_EVIDENCE") is { } output) {
            Directory.CreateDirectory(output);
            File.WriteAllText(Path.Combine(output, "bounded-sizes.json"), JsonConvert.SerializeObject(summary, Formatting.Indented));
            File.WriteAllText(Path.Combine(output, "bounded-index.json"), Json(context));
            // Browser fixtures use the production shaper, including staged assumptions. No client solver.
            var scenarios = new List<object>();
            foreach (var id in new[] { "g8079765", "g8761260", "g6293931" }) {
                var group = snapshot.Groups.Single(g => g.Id == id);
                var values = new Dictionary<string, DuctWorkAssumption>();
                void Save() {
                    var request = new DuctSnapshotRequest { Group = id, Context = true,
                        Assumptions = new(scenarios.Count, new Dictionary<string, DuctWorkAssumption>(values)) };
                    var response = DuctSnapshotReader.Read(snapshot, request);
                    Assert.That(response.Pressure!.AssumptionRevision, Is.EqualTo(request.Assumptions.Revision));
                    scenarios.Add(new { request, response });
                }
                Save();
                foreach (var root in group.RootIds) {
                    values.Clear();
                    values[$"fan-static:{root}"] = new(DuctAssumptionKind.FanStatic, InWg: .5);
                    Save();
                }
            }
            File.WriteAllText(Path.Combine(output, "pressure-fixtures.json"), Json(new { index = context, scenarios }));
        }
        TestContext.WriteLine(Json(summary));
        Assert.That(Bytes(index), Is.LessThan(200_000), "Pea's default document index must remain bounded.");
    }
}
