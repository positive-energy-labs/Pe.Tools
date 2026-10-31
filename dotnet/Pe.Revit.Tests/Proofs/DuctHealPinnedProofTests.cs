using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests.Proofs;

/// <summary>
///     Documents how `ducts.heal` meets a pinned element (counsel 2026-10-22: a pin is user intent, never unpinned).
///     A union that would move or replace a pinned duct is refused with a plain reason and the document is left as it
///     was; the same union, unpinned, heals. The fixture is built in code from the year's Mechanical-Default template:
///     five 12 in round ducts and four elbows in a ring, open at one 2 in collinear gap, so both ends share a system.
/// </summary>
[TestFixture]
public sealed class DuctHealPinnedProofTests {
    private const double Gap = 2.0 / 12;

    [Test]
    public void Pinned_duct_refuses_a_union_and_heals_once_unpinned(UIApplication uiapp) {
        var app = uiapp.Application;
        RevitTestFailureGuard.EnsureInstalled(app);
        var doc = app.NewProjectDocument(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk\\RVT {app.VersionNumber}\\Templates\\English-Imperial\\Mechanical-Default.rte"));
        try {
            var (left, right) = Ring(doc);
            var (a, b) = (End(left, new XYZ(10, 0, 10)), End(right, new XYZ(10 + Gap, 0, 10)));
            Assert.That(a.MEPSystem?.Id, Is.EqualTo(b.MEPSystem?.Id), "the fixture's two open ends must share a system");
            var request = new DuctHealRequest(false, [
                new DuctHealGroup("ring", [new DuctHealItem("gap", DuctHealKind.Join, Key(a), Key(b))])
            ]);

            Pin(doc, right, true);
            var before = State(doc);
            var refused = DuctHealer.Heal(doc, request).Groups.Single();
            Assert.Multiple(() => {
                Assert.That(refused.Outcome, Is.EqualTo("empty"));
                Assert.That(refused.Items.Single().Outcome, Is.EqualTo("refused"));
                Assert.That(refused.Items.Single().How, Is.EqualTo("union"));
                Assert.That(refused.Items.Single().Reason, Is.EqualTo($"{right.Id.Value()} is pinned; unpin it to heal"));
                Assert.That(State(doc), Is.EqualTo(before), "a refused heal changed the document");
            });

            Pin(doc, right, false);
            var healed = DuctHealer.Heal(doc, request).Groups.Single();
            Assert.Multiple(() => {
                Assert.That(healed.Outcome, Is.EqualTo("healed"), healed.Reason);
                Assert.That(healed.Items.Single().Outcome, Is.EqualTo("healed"), healed.Items.Single().Reason);
                Assert.That(healed.Items.Single().How, Is.EqualTo("union"));
                Assert.That(State(doc), Is.Not.EqualTo(before));
            });
        } finally {
            _ = doc.Close(false);
        }
    }

    /// <summary>Ducts A (0,0)-(10,0) and B (10+gap,0)-(20,0), joined the long way round through C, D, E and four elbows.</summary>
    internal static (Duct Left, Duct Right) Ring(Document doc) {
        using var t = new Transaction(doc, "duct heal pinned proof: ring");
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
        XYZ At(double x, double y) => new(x, y, 10);
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

    internal static Connector End(Element e, XYZ near) =>
        DuctSnapshots.HvacConnectors(e).OrderBy(c => c.Origin.DistanceTo(near)).First();

    internal static string Key(Connector c) => $"{c.Owner.Id.Value()}:{c.Id}";

    private static void Pin(Document doc, Element e, bool pinned) {
        using var t = new Transaction(doc, "duct heal pinned proof: pin");
        _ = t.Start();
        e.Pinned = pinned;
        _ = t.Commit();
    }

    /// <summary>Every duct and duct fitting: id, pin, connector origins and whether each is connected (by connector id: Revit enumerates them in no stable order).</summary>
    private static string State(Document doc) =>
        string.Join("\n", new FilteredElementCollector(doc).WherePasses(new ElementMulticategoryFilter(new List<BuiltInCategory> {
                BuiltInCategory.OST_DuctCurves, BuiltInCategory.OST_DuctFitting
            })).WhereElementIsNotElementType().ToElements().OrderBy(e => e.Id.Value())
            .Select(e => $"{e.Id.Value()} {e.Pinned} " + string.Join(" ", DuctSnapshots.HvacConnectors(e).OrderBy(c => c.Id)
                .Select(c => $"{c.Id}@{c.Origin.X:0.0000},{c.Origin.Y:0.0000},{c.Origin.Z:0.0000}:{c.IsConnected}"))));
}
