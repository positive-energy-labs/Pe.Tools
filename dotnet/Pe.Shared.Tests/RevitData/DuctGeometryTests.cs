using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The fitting geometry facts ducts.snapshot derives for a table lookup, over a hand-built graph.</summary>
[TestFixture]
public sealed class DuctGeometryTests {
    private static DuctConnector Round(int index, double d, long? to = null, int toPort = 0, string kind = "end") =>
        new(index, kind, [0, 0, 0], DuctShape.Round, $"{d}\"ø", d, null, null, null, "bidirectional", null,
            to is { } id ? new DuctRef(id, toPort) : null);

    private static DuctConnector Rect(int index, double w, double h, long? to = null, int toPort = 0) =>
        new(index, "end", [0, 0, 0], DuctShape.Rectangular, $"{w}x{h}", null, w, h, null, "bidirectional", null,
            to is { } id ? new DuctRef(id, toPort) : null);

    private static DuctNode Node(long id, DuctNodeKind kind, string? part, IReadOnlyList<DuctConnector> ports, params DuctFact[] facts) =>
        new(id, kind, kind.ToString(), "Fam", "Type", part, null, [0, 0, 0], null, "SA 1", "Supply Air", ports, facts);

    private static DuctSegment Duct(long id, double d, params DuctConnector[] ports) =>
        new(id, DuctSegmentKind.Duct, "Round", DuctShape.Round, $"{d}\"ø", d, null, null, 10,
            [[0, 0, 0], [10, 0, 0]], null, null, "SA 1", "Supply Air",
            new DuctRoughness(0.0003, DuctProvenance.RevitDefault), new DuctRevitValues(null, null, null, null), ports);

    private static double? F(DuctNetwork.Analysis a, long id, string key) => DuctNetwork.Fact(a.Nodes.Single(n => n.Id == id), key);

    // Unit 1 -> transition 20 (16x12 rect in, 12 round out) -> trunk 10 (12 in) -> elbow 21 (r 12 in) -> duct 11
    //   -> grille 30; trunk 10 carries a takeoff 22 on its curve connector 3 -> 6 in duct 12 -> grille 31.
    private static DuctNetwork.Analysis Build() {
        var nodes = new List<DuctNode> {
            Node(1, DuctNodeKind.Equipment, null, [Rect(1, 16, 12, 20, 1)]),
            Node(20, DuctNodeKind.Fitting, "Transition", [Round(2, 12, 10, 1), Rect(1, 16, 12, 1, 1)]),
            Node(21, DuctNodeKind.Fitting, "Elbow", [Round(1, 12, 10, 2), Round(2, 12, 11, 1)],
                new DuctFact(DuctNetwork.CenterRadius, 12, null, "in", DuctProvenance.Geometry)),
            Node(22, DuctNodeKind.Fitting, "TapPerpendicular", [Round(1, 6, 10, 3), Round(2, 6, 12, 1)]),
            Node(30, DuctNodeKind.Terminal, null, [Round(1, 12, 11, 2)], new DuctFact(DuctNetwork.TerminalFlow, 300, null, "cfm", DuctProvenance.DesignerStated)),
            Node(31, DuctNodeKind.Terminal, null, [Round(1, 6, 12, 2)], new DuctFact(DuctNetwork.TerminalFlow, 100, null, "cfm", DuctProvenance.DesignerStated))
        };
        var segments = new List<DuctSegment> {
            Duct(10, 12, Round(1, 12, 20, 2), Round(2, 12, 21, 1), Round(3, 6, 22, 1, "curve")),
            Duct(11, 12, Round(1, 12, 21, 2), Round(2, 12, 30, 1)),
            Duct(12, 6, Round(1, 6, 22, 2), Round(2, 6, 31, 1))
        };
        return DuctNetwork.Analyze(nodes, segments);
    }

    [Test]
    public void Elbow_gets_r_over_d_from_center_radius() =>
        Assert.That(F(Build(), 21, DuctNetwork.ROverD), Is.EqualTo(1.0));

    [Test]
    public void Transition_ratio_follows_flow_from_the_root() {
        var a = Build();
        Assert.That(F(a, 20, DuctNetwork.Inlet), Is.EqualTo(1), "the rect connector faces the unit");
        Assert.That(F(a, 20, DuctNetwork.AoOverA1), Is.EqualTo(Math.Round(Math.PI / 4 * 144 / (16 * 12), 4)));
        Assert.That(a.Nodes.Single(n => n.Id == 20).Facts.Single(f => f.Key == DuctNetwork.AoOverA1).Provenance,
            Is.EqualTo(DuctProvenance.Geometry));
    }

    [Test]
    public void Takeoff_names_its_main_and_area_ratio() {
        var a = Build();
        Assert.That(F(a, 22, DuctNetwork.Takeoff), Is.EqualTo(1));
        Assert.That(F(a, 22, DuctNetwork.MainSegment), Is.EqualTo(10));
        Assert.That(F(a, 22, DuctNetwork.MainDiameter), Is.EqualTo(12));
        Assert.That(F(a, 22, DuctNetwork.AbOverAc), Is.EqualTo(0.25));
        Assert.That(F(a, 21, DuctNetwork.Takeoff), Is.Null, "an elbow on duct ends is not a takeoff");
        Assert.That(a.Flows.Single(f => f.SegmentId == 10).Cfm, Is.EqualTo(400));
    }

    [Test]
    public void Loss_and_terminal_drop_round_trip_through_the_wire_shape() {
        var loss = new DuctLoss(DuctLossMethod.SpecificCoefficient, "5a598293-1504-46cc-a9c0-de55c82848b9", null, 0.25, null, 0.012,
            new Dictionary<string, string> { ["Coefficient"] = "0.25" });
        var json = Newtonsoft.Json.JsonConvert.SerializeObject(loss);
        Assert.That(json, Does.Contain("\"specific-coefficient\""));
        var back = Newtonsoft.Json.JsonConvert.DeserializeObject<DuctLoss>(json)!;
        Assert.That(back.Method, Is.EqualTo(DuctLossMethod.SpecificCoefficient));
        Assert.That(back.Coefficient, Is.EqualTo(0.25));
        Assert.That(new DuctParameterSlots().FanStatic, Is.EqualTo("PE_M_Fan_ExternalStaticPressure"));
    }
}
