using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Shared.HostContracts.RevitData;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterCollectionArtifactCollectorTests {
    [Test]
    public void Parameter_collection_artifact_collector_collects_filtered_duct_accessory_data(
        UIApplication uiApplication
    ) {
        const string familyName = "_PE_DA_DuctAccessory";
        const string sharedParameterName = "_PE_DA_DuctAccessoryBinding";

        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Parameter_collection_artifact_collector_collects_filtered_duct_accessory_data)
        );
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_DuctAccessory,
            familyName
        );

        try {
            using (var transaction = new Transaction(familyDocument, "Seed duct accessory family")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Primary");
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "_PE_DA_FamilyLength",
                        SpecTypeId.Length,
                        GroupTypeId.Geometry,
                        false
                    )
                );
                _ = transaction.Commit();
            }

            var familyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                outputDirectory,
                "duct-accessory"
            );
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, familyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var sharedDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(
                projectDocument,
                new RevitFamilyFixtureHarness.SharedDefinitionSpec(
                    sharedParameterName,
                    SpecTypeId.String.Text,
                    "DaAutomation",
                    "Parameter collection test binding.",
                    Guid.NewGuid()
                )
            );
            var bindingResult = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                sharedDefinition,
                true,
                GroupTypeId.IdentityData,
                BuiltInCategory.OST_DuctAccessory
            );

            Assert.Multiple(() => {
                Assert.That(bindingResult.BindingSucceeded, Is.True);
                Assert.That(bindingResult.DefinitionExisted, Is.False);
            });

            var filter = new LoadedFamiliesFilter {
                CategoryNames = ["Duct Accessories"]
            };

            var artifact = ParameterCollectionArtifactCollector.Collect(
                projectDocument,
                "test-run",
                "Autodesk.Revit+2025",
                "US",
                Guid.NewGuid().ToString("D"),
                Guid.NewGuid().ToString("D"),
                filter
            );

            var collectedFamily = artifact.LoadedFamiliesMatrix.Families
                .SingleOrDefault(entry => string.Equals(entry.FamilyName, familyName, StringComparison.Ordinal));
            var collectedBinding = artifact.ProjectParameterBindings.Entries
                .SingleOrDefault(entry => string.Equals(entry.Identity.Name, sharedParameterName, StringComparison.Ordinal));

            Assert.Multiple(() => {
                Assert.That(artifact.DocumentTitle, Is.EqualTo(projectDocument.Title));
                Assert.That(artifact.LoadedFamiliesMatrix.Families, Is.Not.Empty);
                Assert.That(
                    artifact.LoadedFamiliesMatrix.Families.All(entry =>
                        string.Equals(entry.CategoryName, "Duct Accessories", StringComparison.Ordinal)),
                    Is.True
                );
                Assert.That(collectedFamily, Is.Not.Null);
                Assert.That(collectedFamily!.CategoryName, Is.EqualTo("Duct Accessories"));
                Assert.That(collectedFamily.Types.Select(type => type.TypeName), Contains.Item("Primary"));
                Assert.That(collectedBinding, Is.Not.Null);
                Assert.That(collectedBinding!.CategoryNames, Is.EqualTo(new[] { "Duct Accessories" }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }
}
