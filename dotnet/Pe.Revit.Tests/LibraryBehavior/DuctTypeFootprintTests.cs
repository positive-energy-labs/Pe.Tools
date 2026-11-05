using Pe.Revit.Extensions.FamDocument;
using Autodesk.Revit.DB.Structure;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests;

/// <summary>
///     A fan static owned by a shared type moves every unit of that type (Chadds MUAS-1 and MUAS-2 share Fantech
///     MUAS10). Requesting one unit must refuse at plan and apply, name the unrequested peer, and write nothing.
/// </summary>
[TestFixture]
public sealed class DuctTypeFootprintTests {
    private const string TypeStatic = "PE_M_Fan_ExternalStaticPressure";
    private const string InstanceStatic = "PE_Test_InstanceStatic";

    [Test]
    public void Type_owned_static_refuses_an_unnamed_peer_and_writes_nothing_while_instance_statics_write(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var family = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_MechanicalEquipment, "PeTypeFootprintFan");
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        try {
            using (var t = new Transaction(family, "Fan statics")) {
                t.Start();
                family.FamilyManager.AddParameter(TypeStatic, GroupTypeId.Mechanical, SpecTypeId.HvacPressure, false);
                family.FamilyManager.AddParameter(InstanceStatic, GroupTypeId.Mechanical, SpecTypeId.HvacPressure, true);
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var loaded = family.LoadFamily(project, new DefaultFamilyLoadOptions());
            FamilyInstance one, two;
            FamilySymbol type;
            using (var t = new Transaction(project, "Two units of one type")) {
                t.Start();
                type = (FamilySymbol)project.GetElement(loaded.GetFamilySymbolIds().First());
                type.Activate();
                var level = new FilteredElementCollector(project).OfClass(typeof(Level)).Cast<Level>().FirstOrDefault()
                            ?? Level.Create(project, 0);
                one = project.Create.NewFamilyInstance(XYZ.Zero, type, level, StructuralType.NonStructural);
                two = project.Create.NewFamilyInstance(new XYZ(10, 0, 0), type, level, StructuralType.NonStructural);
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            double TypeValue() => type.LookupParameter(TypeStatic).AsDouble();
            var before = TypeValue();
            var store = new DuctLossStore { Version = DuctLossStore.CurrentVersion };
            DuctApplyRequest Ask(DuctParameterSlotOverrides? slots, params DuctEquipmentWrite[] writes) =>
                new(slots, [], [], [], writes, [], [], store);

            var request = Ask(null, new DuctEquipmentWrite(one.Id.Value(), 2.6581));
            foreach (var preview in new[] { true, false }) {
                var result = DuctApplier.Apply(project, request, preview);
                var row = result.Writes.Single(w => w.Kind == "equipment");
                Assert.Multiple(() => {
                    Assert.That(row.Outcome, Is.EqualTo("refused"), $"preview={preview}");
                    Assert.That(row.Reason, Does.Contain(type.Name).And.Contain(two.Id.Value().ToString()), "names the type and the unrequested peer");
                    Assert.That(result.Writes.Where(w => w.Outcome == "planned" || w.Outcome == "written"), Is.Empty, "nothing else lands beside it");
                });
            }
            Assert.Multiple(() => {
                Assert.That(TypeValue(), Is.EqualTo(before), "the shared type is unchanged for both units");
                Assert.That(DuctApplier.ReadStore(project).Store, Is.Null, "no store transaction ran");
            });

            // Every unit of the type with one value is a cohort the Work expresses; different values still refuse.
            Assert.That(DuctApplier.Apply(project, Ask(null, new(one.Id.Value(), 2.6581), new(two.Id.Value(), 2.6581)), true)
                .Writes.Single(w => w.Kind == "equipment" && w.Id == one.Id.Value()).Outcome, Is.EqualTo("planned"));
            Assert.That(DuctApplier.Apply(project, Ask(null, new(one.Id.Value(), 1), new(two.Id.Value(), 2)), true)
                .Writes.Where(w => w.Kind == "equipment").Select(w => w.Outcome), Is.All.EqualTo("refused"));

            // Control: an instance-owned static writes one unit and leaves its peer alone.
            var control = DuctApplier.Apply(project, Ask(new DuctParameterSlotOverrides(FanStatic: InstanceStatic), new DuctEquipmentWrite(one.Id.Value(), 1.5)), false);
            Assert.Multiple(() => {
                Assert.That(control.Writes.Single(w => w.Kind == "equipment").Outcome, Is.EqualTo("written"));
                Assert.That(one.LookupParameter(InstanceStatic).AsDouble(), Is.Not.EqualTo(0));
                Assert.That(two.LookupParameter(InstanceStatic).AsDouble(), Is.EqualTo(0));
                Assert.That(TypeValue(), Is.EqualTo(before));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(family);
            RevitFamilyFixtureHarness.CloseDocument(project);
        }
    }
}
