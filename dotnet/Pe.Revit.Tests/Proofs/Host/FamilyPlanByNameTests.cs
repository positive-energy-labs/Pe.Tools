using Pe.App.Host;
using Pe.Shared.HostContracts.Operations;

namespace Pe.Revit.Tests;

/// <summary>
///     families.plan names its families (seam-domains-families-plan-by-name): a name resolves to the id loaded at plan, the sealed id
///     carries to apply, and a reload between them refuses by name. A leftover cell keyed by the same name plans again after a reload.
/// </summary>
[TestFixture]
public sealed class FamilyPlanByNameTests {
    private const string FamilyName = "PE Plan By Name";
    private UIApplication _ui = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void A_name_plans_applies_and_plans_again_after_the_reload_and_a_stale_plan_refuses_by_name() {
        const string first = """{"patch":{"types":{"Standard":{"Proof":"a"}}}}""";
        const string leftover = """{"patch":{"types":{"Standard":{"Proof":"b"}}}}""";
        var app = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(FamilyPlanByNameTests));
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            var id = Load(app, project, directory).Id.Value();

            var plan = FamilyFoundryBridgeOps.PlanFamilies(first, project, [FamilyName]).Families.Single();
            Assert.That((plan.FamilyId, plan.FamilyName, plan.Refusals.Count), Is.EqualTo(((long?)id, FamilyName, 0)), "the plan names the requested family and the id it resolved to");
            var stalePlan = FamilyFoundryBridgeOps.PlanFamilies(leftover, project, [FamilyName]).Families.Single();

            var applied = Apply(first, plan, project, directory, "apply");
            Assert.That(applied.Success && applied.Converged, Is.True, applied.Error);
            Assert.That((applied.FamilyId, applied.FamilyName), Is.EqualTo((id, FamilyName)));
            Assert.That(applied.LoadedFamilyId, Is.Not.Null.And.Not.EqualTo(id), "an edited reload gives the Family a new element id");

            var stale = Apply(leftover, stalePlan, project, directory, "stale");
            Assert.That(stale.Success, Is.False);
            Assert.That(stale.FamilyName, Is.EqualTo(FamilyName));
            Assert.That(stale.Error, Is.EqualTo($"'{FamilyName}' was reloaded since this plan; plan again."));

            var again = FamilyFoundryBridgeOps.PlanFamilies(leftover, project, [FamilyName]).Families.Single();
            Assert.That(again.FamilyId, Is.EqualTo(applied.LoadedFamilyId), "the same name plans against the new id");
            Assert.That(again.Refusals, Is.Empty);
            Assert.That(again.Changes, Is.Not.Empty);
            var reapplied = Apply(leftover, again, project, directory, "again");
            Assert.That(reapplied.Success && reapplied.Converged, Is.True, reapplied.Error);
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    [Test]
    public void An_unknown_name_is_a_refused_entry_named_by_its_name_while_the_others_plan() {
        const string patch = """{"patch":{"types":{"Standard":{"Proof":"a"}}}}""";
        var app = this._ui.Application;
        var directory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{nameof(FamilyPlanByNameTests)}-unknown");
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(app);
        try {
            _ = Load(app, project, directory);
            var data = FamilyFoundryBridgeOps.PlanFamilies(patch, project, ["No Such Family", FamilyName]);
            Assert.That(data.Diagnostics, Is.Empty, "a refused name refuses its own entry, never the whole plan");
            var unknown = data.Families[0];
            Assert.That((unknown.FamilyId, unknown.FamilyName), Is.EqualTo(((long?)null, "No Such Family")));
            Assert.That(unknown.Refusals.Single().Code, Is.EqualTo("family-not-found"));
            Assert.That(unknown.Refusals.Single().Message, Is.EqualTo("No loaded family named 'No Such Family'."));
            Assert.That(data.Families[1].Refusals, Is.Empty);
            Assert.That(data.Families[1].FamilyId, Is.Not.Null);
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    /// <summary>What the host sends: the plan's sealed id keys the hash and the plan's name.</summary>
    private static FamilyFoundryApplyReceipt Apply(string spec, FamilyFoundryFamilyPlanData plan, Document project, string directory, string run) {
        var id = plan.FamilyId!.Value;
        return FamilyFoundryBridgeOps.ApplyFamilies(spec, new Dictionary<long, string> { [id] = plan.PlanHash }, project, null, null,
            Path.Combine(directory, run), new Dictionary<long, string> { [id] = plan.FamilyName }).Receipts.Single();
    }

    private static Family Load(Autodesk.Revit.ApplicationServices.Application app, Document project, string directory) {
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
        return RevitFamilyFixtureHarness.LoadFamilyIntoProject(app, project, path);
    }
}
