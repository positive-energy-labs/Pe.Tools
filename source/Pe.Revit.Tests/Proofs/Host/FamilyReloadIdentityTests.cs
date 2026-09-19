using Autodesk.Revit.DB.Structure;
using Pe.App.Host;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

/// <summary>
///     Family element identity across a value-only reload (mid-cancel run: families.apply replaced Family 1235365 with 1237003;
///     w8 saw "a family's element id changes on every successful apply"). Settled direction: stable identity. Each arm adds
///     one layer of our path onto a bare Revit reload, so the first arm that loses an id names the cause:
///     bare-load (EditFamily → LoadFamily, no edit), bare-edit-load (+ one committed value edit), visit (FamilyVisit.Run:
///     open gate, transaction group, failure scope), apply (FamilyFoundryBridgeOps.ApplyFamilies: plan, reconcile, receipt).
///     Ids are printed as [PE_FAMILY_RELOAD_IDS] so a red arm still reports what changed.
/// </summary>
[TestFixture]
public sealed class FamilyReloadIdentityTests {
    private const string FamilyName = "PE Reload Identity";
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [TestCase("bare-load")]
    [TestCase("bare-edit-load")]
    [TestCase("visit")]
    [TestCase("apply")]
    public void Family_symbol_and_instance_ids_survive_a_value_only_reload(string arm) {
        var app = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{nameof(FamilyReloadIdentityTests)}-{arm}");
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(app, BuiltInCategory.OST_GenericModel, FamilyName);
        string path;
        try {
            using (var t = new Transaction(familyDocument, "Seed")) {
                _ = t.Start();
                RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Standard");
                _ = familyDocument.FamilyManager.AddParameter("Proof", GroupTypeId.Data, SpecTypeId.String.Text, false);
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            path = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, directory, FamilyName);
        } finally { RevitFamilyFixtureHarness.CloseDocument(familyDocument); }

        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            var family = RevitFamilyFixtureHarness.LoadFamilyIntoProject(app, project, path);
            FamilyInstance instance;
            using (var t = new Transaction(project, "Place")) {
                _ = t.Start();
                var symbol = (FamilySymbol)project.GetElement(family.GetFamilySymbolIds().Single());
                symbol.Activate();
                instance = project.Create.NewFamilyInstance(XYZ.Zero, symbol, StructuralType.NonStructural);
                Assert.That(t.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var instanceId = instance.Id;
            var before = Ids(project, instanceId);

            switch (arm) {
                case "bare-load":
                case "bare-edit-load": {
                    var edit = project.EditFamily(family);
                    try {
                        if (arm == "bare-edit-load") {
                            using var t = new Transaction(edit, "Value");
                            _ = t.Start();
                            edit.FamilyManager.Set(edit.FamilyManager.get_Parameter("Proof"), "x");
                            _ = t.Commit();
                        }
                        _ = edit.LoadFamily(project, new DefaultFamilyLoadOptions());
                    } finally { _ = edit.Close(false); }
                    break;
                }
                case "visit": {
                    var result = FamilyVisit.Run(project, family,
                        scope => scope.Edit("Value", d => d.FamilyManager.Set(d.FamilyManager.get_Parameter("Proof"), "x")));
                    Assert.That(result.Verified, Is.True, result.Message);
                    break;
                }
                case "apply": {
                    const string patch = """{"patch":{"types":{"Standard":{"Proof":"x"}}}}""";
                    var id = family.Id.Value();
                    var plan = FamilyFoundryBridgeOps.PlanFamilies(patch, project, [id]).Families.Single();
                    var receipt = FamilyFoundryBridgeOps.ApplyFamilies(patch, new Dictionary<long, string> { [id] = plan.PlanHash }, project, null, null,
                        Path.Combine(directory, "apply")).Receipts.Single();
                    Assert.That(receipt.Success && receipt.Converged, Is.True, receipt.Error);
                    break;
                }
            }

            var after = Ids(project, instanceId);
            Console.WriteLine($"[PE_FAMILY_RELOAD_IDS] {arm} before={before} after={after}");
            Assert.That(after, Is.EqualTo(before), "Family, FamilySymbol and instance identity must survive a value-only reload.");
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    /// <summary>Family id and UniqueId, its symbol ids, and the placed instance's id and symbol id, as one comparable line.</summary>
    private static string Ids(Document project, ElementId instanceId) {
        var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == FamilyName);
        var symbols = string.Join(",", family.GetFamilySymbolIds().Select(i => i.Value()).OrderBy(i => i));
        var instance = project.GetElement(instanceId) as FamilyInstance;
        return $"family {family.Id.Value()} {family.UniqueId} symbols [{symbols}] instance {(instance is null ? "gone" : $"{instance.Id.Value()} symbol {instance.Symbol.Id.Value()}")}";
    }
}
