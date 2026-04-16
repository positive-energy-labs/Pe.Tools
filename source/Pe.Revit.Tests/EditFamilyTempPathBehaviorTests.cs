using Pe.Revit.Global.Revit.Documents;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class EditFamilyTempPathBehaviorTests {
    private const string ProbeParameterName = "_PE_EditFamily_TempPath_Probe";

    [Test]
    public void EditFamily_reuses_the_dirty_open_family_document_backed_by_the_loaded_family_path(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(EditFamily_reuses_the_dirty_open_family_document_backed_by_the_loaded_family_path));
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var authoringFamilyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(EditFamily_reuses_the_dirty_open_family_document_backed_by_the_loaded_family_path));

        Document? editedFamilyDocument = null;
        Document? reopenedEditedFamilyDocument = null;

        try {
            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(authoringFamilyDocument, outputDirectory, "loaded-family");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);

            editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            using (var transaction = new Transaction(editedFamilyDocument, "Add probe parameter")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    editedFamilyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        ProbeParameterName,
                        SpecTypeId.String.Text,
                        GroupTypeId.IdentityData,
                        IsInstance: false));
                _ = transaction.Commit();
            }

            reopenedEditedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            var openFamilyDocuments = application.Documents.Cast<Document>()
                .Where(document => document.IsFamilyDocument)
                .ToList();

            Assert.Multiple(() => {
                Assert.That(editedFamilyDocument.PathName, Is.EqualTo(savedFamilyPath));
                Assert.That(editedFamilyDocument.GetDocumentPath(), Is.EqualTo(savedFamilyPath));
                Assert.That(editedFamilyDocument.GetDocumentKey(), Is.EqualTo($"family:path:{savedFamilyPath}"));
                Assert.That(reopenedEditedFamilyDocument.PathName, Is.EqualTo(savedFamilyPath));
                Assert.That(reopenedEditedFamilyDocument.GetDocumentKey(), Is.EqualTo(editedFamilyDocument.GetDocumentKey()));
                Assert.That(
                    RevitFamilyFixtureHarness.CollectFamilyParameterProbes(reopenedEditedFamilyDocument)
                        .Any(probe => string.Equals(probe.Name, ProbeParameterName, StringComparison.Ordinal)),
                    Is.True);
                Assert.That(openFamilyDocuments, Has.Count.EqualTo(1));
            });
        } finally {
            CloseAllFamilyDocuments(application);
            RevitFamilyFixtureHarness.CloseDocument(authoringFamilyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Saving_an_edited_family_to_a_temp_path_causes_subsequent_EditFamily_calls_to_open_a_distinct_family_document_for_the_original_loaded_path(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Saving_an_edited_family_to_a_temp_path_causes_subsequent_EditFamily_calls_to_open_a_distinct_family_document_for_the_original_loaded_path));
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var authoringFamilyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(Saving_an_edited_family_to_a_temp_path_causes_subsequent_EditFamily_calls_to_open_a_distinct_family_document_for_the_original_loaded_path));

        Document? editedFamilyDocument = null;
        Document? reopenedProjectFamilyDocument = null;

        try {
            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(authoringFamilyDocument, outputDirectory, "loaded-family");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);

            editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            using (var transaction = new Transaction(editedFamilyDocument, "Add probe parameter")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    editedFamilyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        ProbeParameterName,
                        SpecTypeId.String.Text,
                        GroupTypeId.IdentityData,
                        IsInstance: false));
                _ = transaction.Commit();
            }

            var tempSavedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(editedFamilyDocument, outputDirectory, "temp-saved-family");
            reopenedProjectFamilyDocument = projectDocument.EditFamily(loadedFamily);
            var openFamilyDocuments = application.Documents.Cast<Document>()
                .Where(document => document.IsFamilyDocument)
                .ToList();
            var tempSavedOpenDocument = openFamilyDocuments.Single(document =>
                string.Equals(document.PathName, tempSavedFamilyPath, StringComparison.OrdinalIgnoreCase));

            Assert.Multiple(() => {
                Assert.That(File.Exists(tempSavedFamilyPath), Is.True);
                Assert.That(editedFamilyDocument.PathName, Is.EqualTo(tempSavedFamilyPath));
                Assert.That(editedFamilyDocument.GetDocumentKey(), Is.EqualTo($"family:path:{tempSavedFamilyPath}"));
                Assert.That(
                    RevitFamilyFixtureHarness.CollectFamilyParameterProbes(tempSavedOpenDocument)
                        .Any(probe => string.Equals(probe.Name, ProbeParameterName, StringComparison.Ordinal)),
                    Is.True);

                Assert.That(openFamilyDocuments, Has.Count.EqualTo(2));
                Assert.That(reopenedProjectFamilyDocument.PathName, Is.EqualTo(savedFamilyPath));
                Assert.That(reopenedProjectFamilyDocument.GetDocumentKey(), Is.EqualTo($"family:path:{savedFamilyPath}"));
                Assert.That(reopenedProjectFamilyDocument.GetDocumentKey(), Is.Not.EqualTo(editedFamilyDocument.GetDocumentKey()));
                Assert.That(
                    RevitFamilyFixtureHarness.CollectFamilyParameterProbes(reopenedProjectFamilyDocument)
                        .Any(probe => string.Equals(probe.Name, ProbeParameterName, StringComparison.Ordinal)),
                    Is.False);
            });
        } finally {
            CloseAllFamilyDocuments(application);
            RevitFamilyFixtureHarness.CloseDocument(authoringFamilyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static void CloseAllFamilyDocuments(Application application) {
        foreach (var familyDocument in application.Documents.Cast<Document>()
                     .Where(document => document.IsFamilyDocument)
                     .ToList()) {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }
}
