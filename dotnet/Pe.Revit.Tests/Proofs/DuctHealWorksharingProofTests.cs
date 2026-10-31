using Autodesk.Revit.DB.Mechanical;
using Pe.Revit.Global.Lib.Mep;
using Pe.Shared.RevitData.Ducts;

namespace Pe.Revit.Tests.Proofs;

/// <summary>
///     Documents what a `ducts.heal` preview leaves in central on a workshared model (D8 drive 2026-10-30: probe-sheet's
///     cloud Chadds refused to close with "You still have elements editable" after previews only). The fixture is the
///     pinned proof's ring, made a file-based central in a temp folder and opened as a new local that owns nothing; a
///     cap preview then rolls back. The question is whether the rolled-back edit still borrowed the duct it touched.
/// </summary>
[TestFixture]
public sealed class DuctHealWorksharingProofTests {
    [Test]
    public void A_rolled_back_heal_preview_and_what_it_leaves_borrowed(UIApplication uiapp) {
        var app = uiapp.Application;
        RevitTestFailureGuard.EnsureInstalled(app);
        var dir = Directory.CreateDirectory(Path.Combine(Path.GetTempPath(), $"pe-heal-ws-{Guid.NewGuid():N}")).FullName;
        var central = Path.Combine(dir, "central.rvt");
        var local = Path.Combine(dir, "local.rvt");
        var seed = app.NewProjectDocument(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            $"Autodesk\\RVT {app.VersionNumber}\\Templates\\English-Imperial\\Mechanical-Default.rte"));
        var (left, _) = DuctHealPinnedProofTests.Ring(seed);
        var duct = left.Id;
        seed.EnableWorksharing("Shared Levels and Grids", "Workset1");
        var save = new SaveAsOptions { OverwriteExistingFile = true, MaximumBackups = 1 };
        save.SetWorksharingOptions(new WorksharingSaveAsOptions { SaveAsCentral = true });
        seed.SaveAs(central, save);
        _ = seed.Close(false);
        WorksharingUtils.CreateNewLocal(ModelPathUtils.ConvertUserVisiblePathToModelPath(central), ModelPathUtils.ConvertUserVisiblePathToModelPath(local));
        var doc = app.OpenDocumentFile(ModelPathUtils.ConvertUserVisiblePathToModelPath(local), new OpenOptions());
        try {
            // The central keeps its creator's worksets editable; give everything back so the local starts owning nothing.
            WorksharingUtils.RelinquishOwnership(doc, new RelinquishOptions(true), new TransactWithCentralOptions());
            var end =DuctHealPinnedProofTests.End(doc.GetElement(duct), new XYZ(10, 0, 10));
            var before = WorksharingUtils.GetCheckoutStatus(doc, duct);
            var request = new DuctHealRequest(true, [
                new DuctHealGroup("ring", [new DuctHealItem("cap", DuctHealKind.Cap, DuctHealPinnedProofTests.Key(end), null)])
            ]);
            var result = DuctHealer.Heal(doc, request).Groups.Single();
            var after = WorksharingUtils.GetCheckoutStatus(doc, duct);
            TestContext.Out.WriteLine($"preview: {result.Outcome} / item {result.Items.Single().Outcome} {result.Items.Single().Reason}");
            TestContext.Out.WriteLine($"duct {duct.Value()} checkout before {before}, after {after}; modified {doc.IsModified}");
            Assert.Multiple(() => {
                Assert.That(before, Is.EqualTo(CheckoutStatus.NotOwned), "the fresh local must own nothing");
                Assert.That(result.Items.Single().Outcome, Is.EqualTo("planned"), result.Items.Single().Reason);
                // The finding: a preview that changes nothing must leave nothing borrowed.
                Assert.That(after, Is.EqualTo(CheckoutStatus.NotOwned), "the rolled-back preview left the duct borrowed in central");
            });
        } finally {
            Try(() => WorksharingUtils.RelinquishOwnership(doc, new RelinquishOptions(true), new TransactWithCentralOptions()));
            Try(() => doc.Close(false));
            Try(() => Directory.Delete(dir, true));
        }
    }

    private static void Try(Action act) {
        try {
            act();
        } catch (Exception ex) {
            TestContext.Out.WriteLine($"cleanup: {ex.Message}");
        }
    }
}
