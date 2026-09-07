using Autodesk.Revit.ApplicationServices;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

/// <summary>Normalization acceptance through the processor. Runtime owner runs these on disposable documents.</summary>
[TestFixture]
public sealed class FamilyFoundryBulkMigrationHarnessTests {
    private Application _application = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication application) => this._application = application.Application;

    private Document NewFamily(string name) {
        var document = RevitFamilyFixtureHarness.CreateFamilyDocument(this._application, BuiltInCategory.OST_GenericModel, name);
        using var transaction = new Transaction(document, "Seed normalization case");
        transaction.Start();
        var fm = document.FamilyManager;
        var width = fm.AddParameter("Width", GroupTypeId.Geometry, SpecTypeId.Length, false);
        var keep = fm.AddParameter("Keep", GroupTypeId.Data, SpecTypeId.String.Text, false);
        foreach (var type in new[] { "A", "B" }) {
            fm.CurrentType = fm.NewType(type);
            fm.Set(width, type == "A" ? 1.0 : 2.0);
            fm.Set(keep, type);
        }
        Assert.That(transaction.Commit(), Is.EqualTo(TransactionStatus.Committed));
        return document;
    }

    private static ReconcileFamily WidthPatch(string? expectedHash = null) => new(FamilyPatch.Parse(
        """{"patch":{"parameters":{"Width":{"value":"3ft"}}}}"""), expectedPlanHash: expectedHash);

    [Test]
    public void Explicit_value_updates_every_type_preserves_unmentioned_parameter_and_does_not_save() {
        var document = this.NewFamily("FF normalization values");
        try {
            var path = document.PathName;
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(document.PathName, Is.EqualTo(path));
            foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B")) {
                Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                Assert.That(type.AsString(document.FamilyManager.FindParameter("Keep")), Is.EqualTo(type.Name));
            }
        } finally { document.Close(false); }
    }

    [TestCase(false)]
    [TestCase(true)]
    public void Failed_dependent_work_rolls_back_the_entire_family_and_receipt(bool singleTransaction) {
        var document = this.NewFamily("FF normalization rollback");
        try {
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document, new ExecutionOptions { SingleTransaction = singleTransaction });
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation).Add(new FailFamily()));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Not.Null);
            Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Caller_owned_transaction_does_not_publish_committed_receipt() {
        var document = this.NewFamily("FF normalization caller transaction");
        try {
            using var transaction = new Transaction(document, "Caller owns commit");
            transaction.Start();
            var operation = WidthPatch();
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.False);
            transaction.RollBack();
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Stale_plan_is_rejected_before_parameter_mutation() {
        var document = this.NewFamily("FF normalization drift");
        try {
            var operation = WidthPatch("stale");
            using var processor = new OperationProcessor(document);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.Message, Does.Contain("Plan hash drifted"));
            Assert.That(operation.LastReceipt, Is.Null);
            AssertOriginalWidths(document);
        } finally { document.Close(false); }
    }

    [Test]
    public void Failed_family_does_not_load_and_next_family_can_succeed() {
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(this._application);
        try {
            var families = new List<Family>();
            foreach (var name in new[] { "FF fail", "FF pass" }) {
                var document = this.NewFamily(name);
                try { families.Add(document.LoadFamily(project, new DefaultFamilyLoadOptions())); }
                finally { document.Close(false); }
            }
            var operation = WidthPatch();
            var receipts = new List<bool>();
            using var processor = new OperationProcessor(project, new ExecutionOptions { SingleTransaction = false });
            var (contexts, _) = processor.SelectFamilies(() => families)
                .WithPerFamilyCallback(_ => receipts.Add(operation.LastReceipt?.Converged ?? false))
                .ProcessQueue(new OperationQueue().Add(operation).Add(new FailFamily("FF fail")));
            Assert.That(contexts.Count, Is.EqualTo(2));
            Assert.That(receipts, Is.EqualTo(new[] { false, true }));
            foreach (var family in families) {
                var document = project.EditFamily(family);
                try {
                    if (family.Name == "FF fail") AssertOriginalWidths(document);
                    else foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
                        Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(3.0));
                } finally { document.Close(false); }
            }
        } finally { project.Close(false); }
    }

    private static void AssertOriginalWidths(Document document) {
        foreach (var type in document.FamilyManager.Types.Cast<FamilyType>().Where(t => t.Name is "A" or "B"))
            Assert.That(type.AsDouble(document.FamilyManager.FindParameter("Width")), Is.EqualTo(type.Name == "A" ? 1.0 : 2.0));
    }

    private sealed class FailFamily(string? family = null) : DocOperation<DefaultOperationSettings>(new()) {
        public override string Description => "Injected dependent failure";
        public override OperationLog Execute(FamilyDocument document, FamilyProcessingContext context, OperationContext group) =>
            new(this.Name, [family is null || family == context.FamilyName
                ? new LogEntry("dependent").Error("injected failure")
                : new LogEntry("dependent").Success("accepted")]);
    }
}
