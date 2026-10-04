using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;
using System.Runtime.CompilerServices;

namespace Pe.Shared.Tests.RevitData;

/// <summary>
///     The web's synthetic ducts.snapshot fixture is this graph through DuctNetwork, serialized as the op serializes.
///     It holds no client data. Set PE_WRITE_FIXTURES=1 to rewrite it after a contract change.
/// </summary>
[TestFixture]
public sealed class DuctSyntheticFixtureTests {
    private static readonly JsonSerializerSettings Wire = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy { ProcessDictionaryKeys = false, OverrideSpecifiedNames = false }
        },
        Converters = [new StringEnumConverter()],
        Formatting = Formatting.Indented
    };

    private static string FixturePath([CallerFilePath] string source = "") =>
        Path.GetFullPath(Path.Combine(Path.GetDirectoryName(source)!, "..", "..", "..",
            "ts", "apps", "web", "src", "ducts", "fixtures", "synthetic-snapshot.json"));

    private static DuctConnector Port(int index, double[] at, DuctShape shape, double a, double? b, long to, int toPort, string kind = "end") =>
        new(index, kind, at, shape, shape == DuctShape.Round ? $"{a}\"ø" : $"{a}x{b}",
            shape == DuctShape.Round ? a : null, shape == DuctShape.Round ? null : a, b, null, "bidirectional", "SupplyAir",
            new DuctRef(to, toPort), DuctNetwork.Area(shape, shape == DuctShape.Round ? a : null, a, b) is { } area ? Math.Round(area, 5) : null);

    private static DuctNode Node(long id, DuctNodeKind kind, string family, string? part, double[] at, IReadOnlyList<DuctConnector> ports,
        IReadOnlyList<DuctFact> facts, DuctLoss? loss = null, DuctTerminalDrop? drop = null) =>
        new(id, kind, kind.ToString(), family, "Standard", part, 100, at, null, "SA 1", "Supply Air", ports, facts, loss, drop);

    private static DuctSegment Duct(long id, double d, double[] a, double[] b, params DuctConnector[] ports) =>
        new(id, DuctSegmentKind.Duct, "Round Duct", DuctShape.Round, $"{d}\"ø", d, null, null,
            Math.Round(Math.Sqrt(Math.Pow(b[0] - a[0], 2) + Math.Pow(b[1] - a[1], 2) + Math.Pow(b[2] - a[2], 2)), 3),
            [a, b], 100, null, "SA 1", "Supply Air", new DuctRoughness(0.0003, DuctProvenance.RevitDefault),
            new DuctRevitValues(null, null, null, null), ports);

    private static DuctFact Fact(string key, double value, string unit, DuctProvenance p) => new(key, value, null, unit, p);

    private static DuctLoss Loss(DuctLossMethod method, string server, string? table, double? coefficient) =>
        new(method, server, table, coefficient, null, null,
            table is null ? new Dictionary<string, string>() : new Dictionary<string, string> { ["ASHRAETableName"] = table });

    /// <summary>
    ///     Unit 1 -> 12 in trunk 10 (20 ft) -> elbow 21 (r 12 in) -> 12 in duct 11 -> grille 30 (300 cfm);
    ///     trunk 10's side carries takeoff 22 -> 6 in duct 12 -> grille 31 (100 cfm).
    /// </summary>
    public static DuctSnapshotData Build() {
        const string ashrae = "8baf7d75-8b9b-46d0-b8ce-3ad1c19e6b19";
        const string none = "76eff5da-2e71-45f7-b940-cc5716328ba0";
        var r = DuctShape.Round;
        var nodes = new List<DuctNode> {
            Node(1, DuctNodeKind.Equipment, "Air Handler", null, [0, 0, 9], [Port(1, [0, 0, 9], r, 12, null, 10, 1)],
                [Fact(DuctNetwork.ExternalStatic, 0.5, "in-wg", DuctProvenance.DesignerStated), Fact("fanFlow", 400, "cfm", DuctProvenance.DesignerStated)]),
            Node(21, DuctNodeKind.Fitting, "Round Elbow", "Elbow", [20, 0, 9], [Port(1, [20, 0, 9], r, 12, null, 10, 2), Port(2, [20, 0, 9], r, 12, null, 11, 1)],
                [new DuctFact("angle", 90, null, "deg", DuctProvenance.Geometry), Fact(DuctNetwork.CenterRadius, 12, "in", DuctProvenance.Geometry)],
                Loss(DuctLossMethod.AshraeTable, ashrae, "CD3-21", null)),
            Node(22, DuctNodeKind.Fitting, "Round Takeoff", "TapPerpendicular", [10, 0, 9], [Port(1, [10, 0, 9], r, 6, null, 10, 3), Port(2, [10, -0.5, 9], r, 6, null, 12, 1)],
                [], Loss(DuctLossMethod.NotDefined, none, null, null)),
            Node(30, DuctNodeKind.Terminal, "Supply Grille", null, [20, 10, 9], [Port(1, [20, 10, 9], r, 12, null, 11, 2)],
                [Fact(DuctNetwork.TerminalFlow, 300, "cfm", DuctProvenance.DesignerStated)], drop: new DuctTerminalDrop(0, "NotDefined", false, null)),
            Node(31, DuctNodeKind.Terminal, "Supply Grille", null, [10, -8, 9], [Port(1, [10, -8, 9], r, 6, null, 12, 2)],
                [Fact(DuctNetwork.TerminalFlow, 100, "cfm", DuctProvenance.DesignerStated)], drop: new DuctTerminalDrop(0.05, "SpecificLoss", true, null))
        };
        var segments = new List<DuctSegment> {
            Duct(10, 12, [0, 0, 9], [20, 0, 9], Port(1, [0, 0, 9], r, 12, null, 1, 1), Port(2, [20, 0, 9], r, 12, null, 21, 1),
                Port(3, [10, 0, 9], r, 6, null, 22, 1, "curve")),
            Duct(11, 12, [20, 0, 9], [20, 10, 9], Port(1, [20, 0, 9], r, 12, null, 21, 2), Port(2, [20, 10, 9], r, 12, null, 30, 1)),
            Duct(12, 6, [10, -0.5, 9], [10, -8, 9], Port(1, [10, -0.5, 9], r, 6, null, 22, 2), Port(2, [10, -8, 9], r, 6, null, 31, 1))
        };
        var a = DuctNetwork.Analyze(nodes, segments);
        return new DuctSnapshotData(
            new DuctDocument("Synthetic", DateTimeOffset.Parse("2026-10-04T00:00:00Z"), 1, true),
            [new DuctLevel(100, "Level 1", 0)],
            a.Groups, a.Nodes, a.Segments, a.Flows, a.Issues, [],
            [new DuctSystem(500, "SA 1", "SupplyAir", true, 1, 1, 0.1, [1, 2],
                [new DuctSection(1, 400, 0.04, [10, 21]), new DuctSection(2, 300, 0.06, [11, 30]), new DuctSection(3, 100, 0.05, [22, 12, 31])])],
            new DuctParameterSlots());
    }

    [Test]
    public void Web_fixture_is_this_graph_on_the_wire() {
        var json = JsonConvert.SerializeObject(Build(), Wire).Replace("\r\n", "\n") + "\n";
        var path = FixturePath();
        if (Environment.GetEnvironmentVariable("PE_WRITE_FIXTURES") == "1") {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, json);
        }
        Assert.That(File.Exists(path), $"missing {path}; run with PE_WRITE_FIXTURES=1");
        // Parsed, not byte, equality: the web formats the file (W2's parsed-JSON drift guard, c5e55424).
        var onDisk = Newtonsoft.Json.Linq.JToken.Parse(File.ReadAllText(path));
        Assert.That(Newtonsoft.Json.Linq.JToken.DeepEquals(onDisk, Newtonsoft.Json.Linq.JToken.Parse(json)), Is.True,
            $"{path} drifted from DuctNetwork; run with PE_WRITE_FIXTURES=1 and format it");
    }
}
