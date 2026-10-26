using Newtonsoft.Json;
using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.DocumentData.Families.Loaded.Collectors;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class LoadedFamiliesReadTests {
    private UIApplication _ui = null!;
    [OneTimeSetUp] public void SetUp(UIApplication ui) => this._ui = ui;

    [Test]
    public void Bounded_reads_equal_the_matrix_and_preserve_the_saved_revision_boundary() {
        var project = RevitFamilyFixtureHarness.CreateProjectDocument(this._ui.Application);
        try {
            var family = RevitFamilyFixtureHarness.LoadFamilyFixtureIntoProject(this._ui.Application, project,
                Path.Combine("TagLabels", "Tag_Zone.rfa"));
            var filter = new LoadedFamiliesFilter { FamilyNames = [family.Name] };
            var output = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(LoadedFamiliesReadTests));
            var path = Path.Combine(output, "source.rvt");
            project.SaveAs(path, new SaveAsOptions { OverwriteExistingFile = true });
            var prepared = project.PrepareFamilyRead(filter);
            Assert.That(prepared.Source!.CopyPath, Is.EqualTo(path));
            Assert.That(prepared.Source.Families.Single().FamilyUniqueId, Is.EqualTo(family.UniqueId));
            var extracted = project.ReadLoadedFamilySnapshot(family.Id.Value());
            var budget = new RevitDataOutputBudget { MaxEntries = 100, MaxSamplesPerEntry = 1000 };
            var serial = LoadedFamiliesMatrixCollector.Collect(project, filter, budget: budget, includeTempPlacement: false);
            var supplied = project.WithFamilySnapshots(extracted.Families, new EmptyCache());
            var bounded = LoadedFamiliesMatrixCollector.Collect(project, filter, budget: budget,
                includeTempPlacement: false, snapshotCache: supplied);
            Assert.That(JsonConvert.SerializeObject(bounded), Is.EqualTo(JsonConvert.SerializeObject(serial)));
            Assert.That(() => project.WithFamilySnapshots([extracted.Families.Single() with { FamilyUniqueId = "foreign" }], new EmptyCache()),
                Throws.InvalidOperationException);
            using (var group = new TransactionGroup(project, "read evaluation")) {
                group.Start();
                using (var transaction = new Transaction(project, "temporary project value")) {
                    transaction.Start(); project.ProjectInformation.Name = "temporary"; transaction.Commit();
                }
                group.RollBack();
            }
            Assert.That(project.IsModified, Is.False);
            var afterRollback = project.PrepareFamilyRead(filter).Source!;
            Assert.That(afterRollback.CopyPath, Is.EqualTo(path));
            Assert.That(afterRollback.Version, Is.EqualTo(prepared.Source.Version));
            using (var transaction = new Transaction(project, "unsaved change")) {
                transaction.Start(); project.ProjectInformation.Name = "unsaved"; transaction.Commit();
            }
            Assert.That(project.PrepareFamilyRead(filter).Source!.CopyPath, Is.Null);
            Assert.That(project.PrepareFamilyRead(filter).Source!.CopyRefusal, Does.Contain("unsaved"));
        } finally { RevitFamilyFixtureHarness.CloseDocument(project); }
    }

    private sealed class EmptyCache : IFamilySnapshotCache {
        public bool TryGet(long id, out FamilySnapshotRecord record) { record = null!; return false; }
        public void Store(FamilySnapshotRecord record) { }
    }
}
