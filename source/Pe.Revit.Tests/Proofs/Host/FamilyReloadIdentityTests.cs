using Autodesk.Revit.DB.Structure;
using Pe.App.Host;
using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.Tests;

/// <summary>
///     Family identity across a value-only reload, the ruled behavior (2026-09-19, hold 4 `guid-native4/run2.json`). Revit itself
///     gives an EDITED family a new Family element on LoadFamily (new id and UniqueId), while its FamilySymbol ids, placed instances
///     and name are kept; an unedited reload keeps everything. So a loaded family's stable identity is its name in the document,
///     symbol and instance ids stay id-keyed, and the receipt pair `familyId` → `loadedFamilyId` is the one old→new map.
///     Arms: bare-load (EditFamily → LoadFamily, no edit), bare-edit-load (+ one committed value edit, plain API), visit
///     (FamilyVisit.Run), apply (FamilyFoundryBridgeOps.ApplyFamilies).
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
    public void A_reload_keeps_name_symbols_and_instances_and_the_receipt_maps_the_family_id(string arm) {
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
            var before = Ids(project, instance.Id);
            long? mappedTo = null;

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
                        mappedTo = edit.LoadFamily(project, new DefaultFamilyLoadOptions()).Id.Value();
                    } finally { _ = edit.Close(false); }
                    break;
                }
                case "visit": {
                    var result = FamilyVisit.Run(project, family,
                        scope => scope.Edit("Value", d => d.FamilyManager.Set(d.FamilyManager.get_Parameter("Proof"), "x")));
                    Assert.That(result.Verified, Is.True, result.Message);
                    mappedTo = result.Loaded!.Id.Value();
                    break;
                }
                case "apply": {
                    const string patch = """{"patch":{"types":{"Standard":{"Proof":"x"}}}}""";
                    var id = family.Id.Value();
                    var plan = FamilyFoundryBridgeOps.PlanFamilies(patch, project, [id]).Families.Single();
                    var receipt = FamilyFoundryBridgeOps.ApplyFamilies(patch, new Dictionary<long, string> { [id] = plan.PlanHash }, project, null, null,
                        Path.Combine(directory, "apply")).Receipts.Single();
                    Assert.That(receipt.Success && receipt.Converged, Is.True, receipt.Error);
                    Assert.That(receipt.FamilyId, Is.EqualTo(before.Family), "familyId is the id the apply was asked for");
                    Assert.That(receipt.FamilyName, Is.EqualTo(FamilyName));
                    mappedTo = receipt.LoadedFamilyId;
                    break;
                }
            }

            var after = Ids(project, instance.Id);
            Console.WriteLine($"[PE_FAMILY_RELOAD_IDS] {arm} before={before} after={after}");
            Assert.Multiple(() => {
                Assert.That(after.Symbols, Is.EqualTo(before.Symbols), "type ids are kept");
                Assert.That(after.Instance, Is.EqualTo(before.Instance), "the placed instance is kept");
                Assert.That(after.InstanceSymbol, Is.EqualTo(before.InstanceSymbol), "the instance keeps its type");
                Assert.That(mappedTo, Is.EqualTo(after.Family), "the load (for apply: the receipt's loadedFamilyId) names the Family element there now");
                if (arm == "bare-load")
                    Assert.That(after.Family, Is.EqualTo(before.Family), "an unedited reload keeps the Family element");
            });
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    private sealed record Identity(long Family, string FamilyUniqueId, string Symbols, long? Instance, long? InstanceSymbol) {
        public override string ToString() => $"family {this.Family} {this.FamilyUniqueId} symbols [{this.Symbols}] instance {this.Instance} symbol {this.InstanceSymbol}";
    }

    /// <summary>Found by NAME, the ruled identity; everything else is read off it.</summary>
    private static Identity Ids(Document project, ElementId instanceId) {
        var family = new FilteredElementCollector(project).OfClass(typeof(Family)).Cast<Family>().Single(f => f.Name == FamilyName);
        var instance = project.GetElement(instanceId) as FamilyInstance;
        return new Identity(family.Id.Value(), family.UniqueId,
            string.Join(",", family.GetFamilySymbolIds().Select(i => i.Value()).OrderBy(i => i)),
            instance?.Id.Value(), instance?.Symbol.Id.Value());
    }
}
