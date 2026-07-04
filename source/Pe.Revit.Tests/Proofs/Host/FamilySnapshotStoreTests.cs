using Pe.Revit.DocumentData.Families.Extraction;
using Pe.Revit.Global.Services.Host;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilySnapshotStoreTests {
    [Test]
    public void Warm_start_reseeds_persisted_snapshots_and_drops_deleted_families(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Warm_start_reseeds_persisted_snapshots_and_drops_deleted_families));

        // Build a project with two loaded families and save it.
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        Document? familyDocumentA = null;
        Document? familyDocumentB = null;
        string projectPath;
        long familyIdA;
        long familyIdB;
        try {
            (familyDocumentA, familyIdA) = BuildAndLoad(application, projectDocument, outputDirectory, "snapshot-store-a");
            (familyDocumentB, familyIdB) = BuildAndLoad(application, projectDocument, outputDirectory, "snapshot-store-b");

            projectPath = RevitFamilyFixtureHarness.SaveDocumentCopy(projectDocument, outputDirectory, "snapshot-store-project");

            // Extract both into the shadow and persist at the save boundary.
            var shadow = DocShadow.For(projectDocument);
            foreach (var familyId in new[] { familyIdA, familyIdB }) {
                var family = (Family)projectDocument.GetElement(familyId.ToElementId());
                shadow.Store(FamilySnapshotExtractor.ExtractFromProjectFamily(projectDocument, family));
            }

            FamilySnapshotStore.Persist(projectDocument);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocumentA);
            RevitFamilyFixtureHarness.CloseDocument(familyDocumentB);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }

        // Reopen: both snapshots must warm-start into the fresh document's shadow.
        var reopened = application.OpenDocumentFile(projectPath);
        try {
            FamilySnapshotStore.WarmStart(reopened);
            var shadow = DocShadow.For(reopened);
            Assert.Multiple(() => {
                Assert.That(shadow.TryGet(familyIdA, out _), Is.True, "family A should warm-start");
                Assert.That(shadow.TryGet(familyIdB, out _), Is.True, "family B should warm-start");
            });

            // Delete family A and save WITHOUT persisting (simulates changes the store never saw).
            using (var transaction = new Transaction(reopened, "Delete family A")) {
                _ = transaction.Start();
                _ = reopened.Delete(familyIdA.ToElementId());
                _ = transaction.Commit();
            }

            reopened.Save();
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(reopened);
        }

        // Reopen again: the store still contains A, but A no longer resolves. Non-workshared docs do
        // not report deletions via GetChangedElements — the unresolvable-id check must drop it.
        var reopenedAgain = application.OpenDocumentFile(projectPath);
        try {
            FamilySnapshotStore.WarmStart(reopenedAgain);
            var shadow = DocShadow.For(reopenedAgain);
            Assert.Multiple(() => {
                Assert.That(shadow.TryGet(familyIdA, out _), Is.False, "deleted family A must not warm-start");
                Assert.That(shadow.TryGet(familyIdB, out _), Is.True, "family B should still warm-start");
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(reopenedAgain);
        }
    }

    private static (Document familyDocument, long familyId) BuildAndLoad(
        Application application,
        Document projectDocument,
        string outputDirectory,
        string name
    ) {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            name);
        using (var transaction = new Transaction(familyDocument, "Seed family")) {
            _ = transaction.Start();
            _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
            _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                familyDocument,
                new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                    $"{name}-length",
                    SpecTypeId.Length,
                    GroupTypeId.Geometry,
                    false));
            _ = transaction.Commit();
        }

        var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, name);
        var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
        return (familyDocument, loadedFamily!.Id.Value());
    }
}
