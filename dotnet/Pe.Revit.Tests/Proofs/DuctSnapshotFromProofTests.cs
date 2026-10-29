using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests.Proofs;

/// <summary>
///     Documents the `ducts.snapshot` `from` selector (ducts MAP 2026-10-27, order of work step 2) on the same in-code
///     ring as <see cref="DuctHealPinnedProofTests" />: five 12 in round ducts and four elbows, open at one 2 in gap.
///     A walk from one duct reaches the whole ring through the elbows, stops at the two open ends, and the 36 in
///     candidate box at each open end finds the duct across the gap. The output carries no groups. Model health (ducts
///     LEDGER 2026-10-29) is served by every selector, keyed by element and connector: each of the two ends at the 2 in
///     gap is an open end and a near miss naming the other.
/// </summary>
[TestFixture]
public sealed class DuctSnapshotFromProofTests {
    private const double Gap = 2.0 / 12;

    [Test]
    public void From_walks_the_ring_and_boxes_the_gap(UIApplication uiapp) {
        var app = uiapp.Application;
        RevitTestFailureGuard.EnsureInstalled(app);
        var doc = app.NewProjectDocument(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk\\RVT {app.VersionNumber}\\Templates\\English-Imperial\\Mechanical-Default.rte"));
        try {
            var (left, right) = Ring(doc);
            var snapshot = DuctSnapshots.Snapshot(doc, selector: new DuctSnapshotSelector(DuctSelectorKind.From, UnitId: left.Id.Value()));
            var walk = snapshot.Walk;
            Assert.That(walk, Is.Not.Null);
            Assert.Multiple(() => {
                Assert.That(walk!.ElementsReached, Is.EqualTo(9), "five ducts and four elbows");
                Assert.That(walk.OpenEnds, Is.EqualTo(2), "one end of each duct at the gap");
                Assert.That(walk.Truncated, Is.False);
                Assert.That(snapshot.Groups, Is.Empty);
                Assert.That(snapshot.Systems, Is.Empty);
                Assert.That(snapshot.Segments.Count(s => s.Reason == DuctWalkReason.Walked), Is.EqualTo(5));
                Assert.That(snapshot.Nodes.Count(n => n.Reason == DuctWalkReason.Walked), Is.EqualTo(4));
                Assert.That(snapshot.Nodes.Concat<object>(snapshot.Segments).Count(), Is.EqualTo(9), "the box hits are already walked, so no candidate is added");
                // The gap is 2 in; a 36 in box around either open end holds the other duct, already walked.
                Assert.That(walk.Candidates.Select(c => c.ElementId), Is.EquivalentTo(new[] { left.Id.Value(), right.Id.Value() }));
                Assert.That(walk.Candidates.All(c => c.CandidateCount >= 1), Is.True, "each open end sees the duct across the gap");
            });
            AssertGapHealth(snapshot, left, right, "from");
            // `ids` reads one duct: its partner across the gap is measured as context and never reported on.
            var one = DuctSnapshots.Snapshot(doc, selector: new DuctSnapshotSelector(DuctSelectorKind.Ids, Ids: [left.Id.Value()]));
            var leftEnd = GapEnd(one, left);
            Assert.Multiple(() => {
                Assert.That(one.Issues.Select(i => i.ElementId).Distinct(), Is.EqualTo(new[] { left.Id.Value() }), "ids reports only its own elements");
                Assert.That(leftEnd.Near!.Ports.Single(p => p.AutoJoin).ElementId, Is.EqualTo(right.Id.Value()), "the partner outside the read is measured");
                Assert.That(one.Issues.Single(i => i.Kind == DuctIssueKind.NearMiss).Connector, Is.EqualTo(leftEnd.Connector));
                Assert.That(one.Tolerances, Is.EqualTo(new DuctHealthTolerances(36, 3)));
            });
            AssertGapHealth(DuctSnapshots.Snapshot(doc), left, right, "document");
            // A read's tolerance moves the near miss: at a 1 in auto-join gap the 2 in gap is an open end, not a near miss.
            var tight = DuctSnapshots.Snapshot(doc, selector: new DuctSnapshotSelector(DuctSelectorKind.Ids, Ids: [left.Id.Value()], AutoJoinGapIn: 1));
            Assert.That(tight.Issues.Where(i => i.Kind == DuctIssueKind.NearMiss), Is.Empty);
        } finally {
            _ = doc.Close(false);
        }
    }

    /// <summary>
    ///     The `systems` selector on two separate rings: reading the first ring's Revit system answers that ring's group
    ///     whole, the same group the document read gives it, and never the second ring.
    /// </summary>
    [Test]
    public void Systems_reads_the_named_systems_groups_whole(UIApplication uiapp) {
        var app = uiapp.Application;
        RevitTestFailureGuard.EnsureInstalled(app);
        var doc = app.NewProjectDocument(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk\\RVT {app.VersionNumber}\\Templates\\English-Imperial\\Mechanical-Default.rte"));
        try {
            var (left, right) = Ring(doc);
            var (other, _) = Ring(doc, 100);
            var system = left.MEPSystem?.Id.Value();
            Assert.That(system, Is.Not.Null, "Revit put the ring's ducts in a system");
            Assert.That(other.MEPSystem?.Id.Value(), Is.Not.EqualTo(system), "the second ring is another system");
            var whole = DuctSnapshots.Snapshot(doc);
            var read = DuctSnapshots.Snapshot(doc, selector: new DuctSnapshotSelector(DuctSelectorKind.Systems, SystemIds: [system!.Value]));
            var ring = whole.Segments.Single(s => s.Id == left.Id.Value()).GroupId;
            Assert.Multiple(() => {
                Assert.That(read.Groups.Select(g => g.Id), Is.EqualTo(new[] { ring }), "only the named system's group");
                Assert.That(read.Groups.Single().ElementCount, Is.EqualTo(whole.Groups.Single(g => g.Id == ring).ElementCount), "the group whole");
                Assert.That(read.Segments.Select(s => s.Id), Has.None.EqualTo(other.Id.Value()));
                Assert.That(read.Systems.Select(s => s.Id), Is.EqualTo(new[] { system.Value }));
                Assert.That(read.Layers, Is.Not.Empty, "the document shape: layers are cooked");
                Assert.That(read.Walk, Is.Null);
            });
            AssertGapHealth(read, left, right, "systems");
            Assert.Throws<ArgumentException>(() => DuctSnapshots.Snapshot(doc,
                selector: new DuctSnapshotSelector(DuctSelectorKind.Systems, SystemIds: [left.Id.Value()])), "a duct is not a system");
        } finally {
            _ = doc.Close(false);
        }
    }

    /// <summary>The gap's two ends: each an open end with a near miss naming the other, keyed element:connector.</summary>
    private static void AssertGapHealth(DuctSnapshotData snapshot, Element left, Element right, string selector) {
        var a = GapEnd(snapshot, left);
        var b = GapEnd(snapshot, right);
        Assert.Multiple(() => {
            Assert.That(snapshot.Issues.Where(i => i.Kind == DuctIssueKind.OpenEnd).Select(i => i.Id),
                Is.EquivalentTo(new[] { a.Id, b.Id }), $"{selector}: the ring is open only at the gap");
            Assert.That(a.Id, Is.EqualTo($"open-end:{left.Id.Value()}:{a.Connector}"), selector);
            Assert.That(snapshot.Issues.Where(i => i.Kind == DuctIssueKind.NearMiss).Select(i => i.Id), Is.EquivalentTo(new[] {
                $"near-miss:{left.Id.Value()}:{a.Connector}", $"near-miss:{right.Id.Value()}:{b.Connector}"
            }), selector);
            var mate = a.Near!.Ports.Single(p => p.AutoJoin);
            Assert.That((mate.ElementId, mate.Connector), Is.EqualTo((right.Id.Value(), b.Connector!.Value)), selector);
            Assert.That(mate.GapIn, Is.EqualTo(2).Within(0.01), selector);
            Assert.That(snapshot.Tolerances, Is.EqualTo(new DuctHealthTolerances(36, 3)), selector);
        });
    }

    private static DuctIssue GapEnd(DuctSnapshotData snapshot, Element duct) =>
        snapshot.Issues.Single(i => i.Kind == DuctIssueKind.OpenEnd && i.ElementId == duct.Id.Value());


    private static (Duct Left, Duct Right) Ring(Document doc, double y0 = 0) {
        using var t = new Transaction(doc, "duct snapshot from proof: ring");
        _ = t.Start();
        var system = new FilteredElementCollector(doc).OfClass(typeof(MechanicalSystemType)).Cast<MechanicalSystemType>()
            .First(s => s.SystemClassification == MEPSystemClassification.SupplyAir).Id;
        var type = new FilteredElementCollector(doc).OfClass(typeof(DuctType)).Cast<DuctType>()
            .First(d => d.Shape == ConnectorProfileType.Round
                        && d.RoutingPreferenceManager.GetNumberOfRules(RoutingPreferenceRuleGroupType.Elbows) > 0).Id;
        var level = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.Elevation).First().Id;
        Duct Make(XYZ p, XYZ q) {
            var d = Duct.Create(doc, system, type, level, p, q);
            _ = d.get_Parameter(BuiltInParameter.RBS_CURVE_DIAMETER_PARAM).Set(1.0);
            return d;
        }
        XYZ At(double x, double y) => new(x, y0 + y, 10);
        var ducts = new[] {
            Make(At(0, 0), At(10, 0)), Make(At(10 + Gap, 0), At(20, 0)), Make(At(20, 0), At(20, 10)),
            Make(At(20, 10), At(0, 10)), Make(At(0, 10), At(0, 0))
        };
        doc.Regenerate();
        foreach (var (x, y, corner) in new[] { (1, 2, At(20, 0)), (2, 3, At(20, 10)), (3, 4, At(0, 10)), (4, 0, At(0, 0)) })
            _ = doc.Create.NewElbowFitting(End(ducts[x], corner), End(ducts[y], corner));
        _ = t.Commit();
        return (ducts[0], ducts[1]);
    }

    private static Connector End(Element e, XYZ near) =>
        DuctSnapshots.HvacConnectors(e).OrderBy(c => c.Origin.DistanceTo(near)).First();
}
