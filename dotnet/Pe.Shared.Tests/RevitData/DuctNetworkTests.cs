using NUnit.Framework;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Shared.Tests.RevitData;

/// <summary>The Revit-free half of ducts.snapshot over a hand-built graph.</summary>
[TestFixture]
public sealed class DuctNetworkTests {
    private static DuctConnector Port(int index, long? to = null, int toPort = 0) =>
        new(index, "end", [0, 0, 0], DuctShape.Round, "8\"ø", 8, null, null, null, "bidirectional", null,
            to is { } id ? new DuctRef(id, toPort) : null);

    private static DuctNode Node(long id, DuctNodeKind kind, IReadOnlyList<DuctConnector> ports, params DuctFact[] facts) =>
        new(id, kind, kind.ToString(), "Fam", "Type", null, null, [0, 0, 0], null, "SA 1", "Supply Air", ports, facts);

    private static DuctSegment Duct(long id, double lengthFt, params DuctConnector[] ports) =>
        new(id, DuctSegmentKind.Duct, "Round", DuctShape.Round, "8\"ø", 8, null, null, lengthFt,
            [[0, 0, 0], [lengthFt, 0, 0]], null, null, "SA 1", "Supply Air",
            new DuctRoughness(0.0003, DuctProvenance.RevitDefault), new DuctRevitValues(null, null, null, null), ports);

    [Test]
    public void One_root_tree_sums_terminal_flow_and_names_its_open_end_and_missing_static() {
        // AHU 1 -> duct 10 -> tee 20 -> duct 11 -> terminal 30 (100 cfm)
        //                             \-> duct 12 -> terminal 31 (50 cfm), duct 12 also has an open port.
        var nodes = new List<DuctNode> {
            Node(1, DuctNodeKind.Equipment, [Port(1, 10, 1)]),
            Node(20, DuctNodeKind.Fitting, [Port(1, 10, 2), Port(2, 11, 1), Port(3, 12, 1)]),
            Node(30, DuctNodeKind.Terminal, [Port(1, 11, 2)], new DuctFact(DuctNetwork.TerminalFlow, 100, null, "cfm", DuctProvenance.DesignerStated)),
            Node(31, DuctNodeKind.Terminal, [Port(1, 12, 2)], new DuctFact(DuctNetwork.TerminalFlow, 50, null, "cfm", DuctProvenance.DesignerStated))
        };
        var segments = new List<DuctSegment> {
            Duct(10, 10, Port(1, 1, 1), Port(2, 20, 1)),
            Duct(11, 5, Port(1, 20, 2), Port(2, 30, 1)),
            Duct(12, 5, Port(1, 20, 3), Port(2, 31, 1), Port(3))
        };

        var a = DuctNetwork.Analyze(nodes, segments);

        var group = a.Groups.Single();
        Assert.That(group.Id, Is.EqualTo("g10"));
        Assert.That(group.RootIds, Is.EqualTo(new[] { 1L }));
        Assert.That(group.Loops, Is.EqualTo(0));
        Assert.That(group.TerminalCount, Is.EqualTo(2));
        Assert.That(a.Flows.ToDictionary(f => f.SegmentId, f => f.Cfm),
            Is.EquivalentTo(new Dictionary<long, double> { [10] = 150, [11] = 100, [12] = 50 }));
        Assert.That(a.Issues.Select(i => i.Id), Is.EquivalentTo(new[] { "open-end:g10:12:3", "no-fan-static:g10:1" }));
        Assert.That(a.Nodes.Single(n => n.Id == 1).GroupId, Is.Null, "equipment is cut out of every group");
    }

    [Test]
    public void A_ring_is_a_loop_and_gets_no_flow() {
        var segments = new List<DuctSegment> {
            Duct(10, 5, Port(1, 11, 2), Port(2, 12, 1)),
            Duct(11, 5, Port(1, 12, 2), Port(2, 10, 1)),
            Duct(12, 0.1, Port(1, 10, 2), Port(2, 11, 1))
        };

        var a = DuctNetwork.Analyze([], segments);

        Assert.That(a.Groups.Single().Loops, Is.EqualTo(1));
        Assert.That(a.Flows, Is.Empty);
        Assert.That(a.Issues.Select(i => i.Kind), Is.EquivalentTo(new[] { DuctIssueKind.Loop, DuctIssueKind.Stub, DuctIssueKind.NoRoot }));
    }
}
