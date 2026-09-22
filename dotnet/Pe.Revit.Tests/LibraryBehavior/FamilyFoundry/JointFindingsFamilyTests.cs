using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.Tests;

/// <summary>Native repro for the project-a joint-hold clear-to-empty defect F-J4-2 (tip 3231934, /families bulk path).</summary>
[TestFixture]
public sealed class JointFindingsFamilyTests {
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    private static (Exception? Error, FamilyPreview Preview, ReconcileFamily Operation) Apply(Document document, JObject patchJson) {
        var patch = new FamilyPatch { Patch = patchJson };
        var preview = document.PreviewFamily(patch);
        var operation = new ReconcileFamily(patch, expectedPlanHash: preview.PlanHash);
        using var processor = new OperationProcessor(document);
        var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
        var (_, error) = contexts.Single().OperationLogs;
        return (error, preview, operation);
    }

    // F-J4-2 (ruling 1530-1: empty is a value, not delete): the per-type table dropped "" as "no value", so Revit kept the old text and
    // reconciliation reported residue.
    [TestCase("Text", TestName = "Text_type_parameter_cleared_to_empty_reads_back_empty")]
    [TestCase("Url", TestName = "Url_type_parameter_cleared_to_empty_reads_back_empty")]
    public void Type_parameter_cleared_to_empty_reads_back_empty(string spec) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._ui.Application, BuiltInCategory.OST_GenericModel, "FF clear text");
        try {
            using (var seed = new Transaction(document, "Seed text")) {
                seed.Start();
                var fm = document.FamilyManager;
                var url = fm.AddParameter("Url", GroupTypeId.IdentityData, spec == "Url" ? SpecTypeId.String.Url : SpecTypeId.String.Text, false);
                foreach (var name in new[] { "A", "B" }) {
                    fm.CurrentType = fm.NewType(name);
                    fm.Set(url, $"https://{name.ToLowerInvariant()}.example");
                }
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var (error, preview, operation) = Apply(document, JObject.Parse("""{"types":{"A":{"Url":""}}}"""));
            Assert.That(preview.Changes.Where(c => c.Section == "types.cell").Select(c => c.Key), Is.EqualTo(new[] { "A/Url" }));
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            var manager = document.FamilyManager;
            var parameter = manager.FindParameter("Url");
            Assert.That(parameter, Is.Not.Null, "empty is a value, not delete");
            var types = manager.Types.Cast<FamilyType>().ToDictionary(t => t.Name);
            Assert.That(types["A"].AsString(parameter), Is.EqualTo(string.Empty));
            Assert.That(types["B"].AsString(parameter), Is.EqualTo("https://b.example"));
            var captured = document.CaptureFamilyModel();
            Assert.That(captured.Types["A"].TryGetValue("Url", out var cell) ? cell.Text : "<no cell>", Is.EqualTo(string.Empty),
                "the capture keeps the empty value as a cell, so a reapply is a no-op");
            var again = Apply(document, JObject.Parse("""{"types":{"A":{"Url":""}}}"""));
            Assert.That(again.Operation.LastPlan!.Changes, Is.Empty);
        } finally { RevitFamilyFixtureHarness.CloseDocument(document); }
    }
}
