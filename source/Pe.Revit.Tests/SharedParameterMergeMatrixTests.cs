using Pe.Shared.RevitData.Parameters;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class SharedParameterMergeMatrixTests {
    private sealed record MergeMatrixCase(
        string Name,
        bool AuthorProjectFirst,
        bool ProjectIsInstance,
        bool FamilyIsInstance,
        ForgeTypeId ProjectGroup,
        ForgeTypeId FamilyGroup,
        ForgeTypeId DataType,
        string ExpectedWinningGroupOwner,
        bool ExpectFamilyInstanceToSurvive
    );

    [Test]
    public void Same_guid_shared_parameter_merge_matrix_observes_project_group_precedence_and_family_instance_precedence(UIApplication uiApplication) {
        var cases = new[] {
            new MergeMatrixCase(
                Name: "project_type_vs_family_instance",
                AuthorProjectFirst: true,
                ProjectIsInstance: false,
                FamilyIsInstance: true,
                ProjectGroup: GroupTypeId.Geometry,
                FamilyGroup: GroupTypeId.IdentityData,
                DataType: SpecTypeId.String.Text,
                ExpectedWinningGroupOwner: "project",
                ExpectFamilyInstanceToSurvive: true),
            new MergeMatrixCase(
                Name: "family_type_vs_project_instance",
                AuthorProjectFirst: false,
                ProjectIsInstance: true,
                FamilyIsInstance: false,
                ProjectGroup: GroupTypeId.IdentityData,
                FamilyGroup: GroupTypeId.Geometry,
                DataType: SpecTypeId.String.Text,
                ExpectedWinningGroupOwner: "project",
                ExpectFamilyInstanceToSurvive: true),
            new MergeMatrixCase(
                Name: "project_identity_vs_family_geometry",
                AuthorProjectFirst: true,
                ProjectIsInstance: true,
                FamilyIsInstance: false,
                ProjectGroup: GroupTypeId.IdentityData,
                FamilyGroup: GroupTypeId.Geometry,
                DataType: SpecTypeId.Length,
                ExpectedWinningGroupOwner: "project",
                ExpectFamilyInstanceToSurvive: true)
        };

        foreach (var testCase in cases)
            RunCase(uiApplication.Application, testCase);
    }

    private static void RunCase(
        Autodesk.Revit.ApplicationServices.Application application,
        MergeMatrixCase testCase
    ) {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{nameof(Same_guid_shared_parameter_merge_matrix_observes_project_group_precedence_and_family_instance_precedence)}_{testCase.Name}");
        var sharedGuid = Guid.NewGuid();
        var sharedSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            Name: $"_PE_MergeMatrix_{testCase.Name}",
            DataType: testCase.DataType,
            GroupName: "MergeMatrix",
            Description: $"Matrix case {testCase.Name}",
            Guid: sharedGuid);
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            $"Matrix_{testCase.Name}");

        try {
            if (testCase.AuthorProjectFirst)
                AuthorProjectThenFamily(projectDocument, familyDocument, sharedSpec, testCase);
            else
                AuthorFamilyThenProject(projectDocument, familyDocument, sharedSpec, testCase);

            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, testCase.Name);
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);
            Assert.That(loadedFamily, Is.Not.Null, $"Case '{testCase.Name}' should load the authored family into the project.");

            var projectProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                .Single(probe => probe.SharedGuid == sharedGuid);

            var editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            try {
                var familyProbe = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument)
                    .Single(probe => probe.SharedGuid == sharedGuid);
                var expectedWinningGroup = testCase.ExpectedWinningGroupOwner == "project"
                    ? testCase.ProjectGroup.TypeId
                    : testCase.FamilyGroup.TypeId;
                var expectedFamilyInstance = testCase.ExpectFamilyInstanceToSurvive
                    ? testCase.FamilyIsInstance
                    : testCase.ProjectIsInstance;

                Assert.Multiple(() => {
                    Assert.That(projectProbe.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.SharedGuid)), $"Case '{testCase.Name}' project identity kind");
                    Assert.That(projectProbe.IsInstanceBinding, Is.EqualTo(testCase.ProjectIsInstance), $"Case '{testCase.Name}' project binding scope");
                    Assert.That(projectProbe.GroupTypeId, Is.EqualTo(testCase.ProjectGroup.TypeId), $"Case '{testCase.Name}' project group");
                    Assert.That(projectProbe.DataTypeId, Is.EqualTo(testCase.DataType.TypeId), $"Case '{testCase.Name}' project data type");

                    Assert.That(familyProbe.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.SharedGuid)), $"Case '{testCase.Name}' family identity kind");
                    Assert.That(familyProbe.SharedGuid, Is.EqualTo(sharedGuid), $"Case '{testCase.Name}' family shared guid");
                    Assert.That(familyProbe.DataTypeId, Is.EqualTo(testCase.DataType.TypeId), $"Case '{testCase.Name}' family data type");
                    Assert.That(familyProbe.GroupTypeId, Is.EqualTo(expectedWinningGroup), $"Case '{testCase.Name}' winning group owner");
                    Assert.That(familyProbe.IsInstance, Is.EqualTo(expectedFamilyInstance), $"Case '{testCase.Name}' surviving instance/type authority");
                });
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(editedFamilyDocument);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static void AuthorProjectThenFamily(
        Document projectDocument,
        Document familyDocument,
        RevitFamilyFixtureHarness.SharedDefinitionSpec sharedSpec,
        MergeMatrixCase testCase
    ) {
        var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, sharedSpec);
        RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            projectDocument,
            projectDefinition,
            testCase.ProjectIsInstance,
            testCase.ProjectGroup,
            BuiltInCategory.OST_GenericModel);

        using var transaction = new Transaction(familyDocument, $"Author family parameter {testCase.Name}");
        _ = transaction.Start();
        _ = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
            familyDocument,
            sharedSpec,
            testCase.FamilyGroup,
            testCase.FamilyIsInstance);
        _ = transaction.Commit();
    }

    private static void AuthorFamilyThenProject(
        Document projectDocument,
        Document familyDocument,
        RevitFamilyFixtureHarness.SharedDefinitionSpec sharedSpec,
        MergeMatrixCase testCase
    ) {
        using (var transaction = new Transaction(familyDocument, $"Author family parameter {testCase.Name}")) {
            _ = transaction.Start();
            _ = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                familyDocument,
                sharedSpec,
                testCase.FamilyGroup,
                testCase.FamilyIsInstance);
            _ = transaction.Commit();
        }

        var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, sharedSpec);
        RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            projectDocument,
            projectDefinition,
            testCase.ProjectIsInstance,
            testCase.ProjectGroup,
            BuiltInCategory.OST_GenericModel);
    }
}
