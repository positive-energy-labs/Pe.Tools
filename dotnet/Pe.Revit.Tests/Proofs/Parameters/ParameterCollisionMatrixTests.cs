namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterCollisionMatrixTests {
    private sealed record CollisionMatrixCase(
        string Name,
        bool AuthorProjectFirst,
        SharedDefinitionSpec ProjectSpec,
        RevitFamilyFixtureHarness.ParameterDefinitionSpec? FamilyPlainSpec,
        SharedDefinitionSpec? FamilySharedSpec,
        string ExpectedProjectIdentityKind,
        string ExpectedFamilyIdentityKind,
        bool ExpectDistinctSharedGuids,
        bool ExpectFamilySharedGuid,
        string ExpectedProjectDataTypeId,
        string ExpectedFamilyDataTypeId,
        string ExpectedProjectGroupTypeId,
        string ExpectedFamilyGroupTypeId
    );

    [Test]
    public void Same_name_collision_matrix_preserves_distinct_identities_across_guid_and_datatype_mismatches(
        UIApplication uiApplication) {
        const string sameNameDifferentGuid = "_PE_Collision_SameNameDifferentGuid";
        const string sameNameDifferentDatatype = "_PE_Collision_SameNameDifferentDatatype";

        var cases = new[] {
            new CollisionMatrixCase(
                "project_first__same_name__different_shared_guid",
                true,
                new SharedDefinitionSpec(
                    sameNameDifferentGuid,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Project-side shared parameter.",
                    Guid.NewGuid()),
                null,
                new SharedDefinitionSpec(
                    sameNameDifferentGuid,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Family-side shared parameter with different guid.",
                    Guid.NewGuid()),
                nameof(ParameterIdentityKind.SharedGuid),
                nameof(ParameterIdentityKind.SharedGuid),
                true,
                true,
                SpecTypeId.String.Text.TypeId,
                SpecTypeId.String.Text.TypeId,
                GroupTypeId.IdentityData.TypeId,
                GroupTypeId.IdentityData.TypeId),
            new CollisionMatrixCase(
                "family_first__same_name__different_shared_guid",
                false,
                new SharedDefinitionSpec(
                    sameNameDifferentGuid,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Project-side shared parameter authored second.",
                    Guid.NewGuid()),
                null,
                new SharedDefinitionSpec(
                    sameNameDifferentGuid,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Family-side shared parameter authored first with different guid.",
                    Guid.NewGuid()),
                nameof(ParameterIdentityKind.SharedGuid),
                nameof(ParameterIdentityKind.SharedGuid),
                true,
                true,
                SpecTypeId.String.Text.TypeId,
                SpecTypeId.String.Text.TypeId,
                GroupTypeId.IdentityData.TypeId,
                GroupTypeId.IdentityData.TypeId),
            new CollisionMatrixCase(
                "project_first__same_name__different_datatype",
                true,
                new SharedDefinitionSpec(
                    sameNameDifferentDatatype,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Project string parameter.",
                    Guid.NewGuid()),
                new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                    sameNameDifferentDatatype,
                    SpecTypeId.Length,
                    GroupTypeId.Geometry,
                    false),
                null,
                nameof(ParameterIdentityKind.SharedGuid),
                nameof(ParameterIdentityKind.ParameterElement),
                false,
                false,
                SpecTypeId.String.Text.TypeId,
                SpecTypeId.Length.TypeId,
                GroupTypeId.IdentityData.TypeId,
                GroupTypeId.Geometry.TypeId),
            new CollisionMatrixCase(
                "family_first__same_name__different_datatype",
                false,
                new SharedDefinitionSpec(
                    sameNameDifferentDatatype,
                    SpecTypeId.String.Text,
                    "CollisionMatrix",
                    "Project string parameter authored second.",
                    Guid.NewGuid()),
                new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                    sameNameDifferentDatatype,
                    SpecTypeId.Length,
                    GroupTypeId.Geometry,
                    false),
                null,
                nameof(ParameterIdentityKind.SharedGuid),
                nameof(ParameterIdentityKind.ParameterElement),
                false,
                false,
                SpecTypeId.String.Text.TypeId,
                SpecTypeId.Length.TypeId,
                GroupTypeId.IdentityData.TypeId,
                GroupTypeId.Geometry.TypeId)
        };

        foreach (var testCase in cases)
            RunCase(uiApplication.Application, testCase);
    }

    private static void RunCase(
        Application application,
        CollisionMatrixCase testCase
    ) {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            $"{nameof(Same_name_collision_matrix_preserves_distinct_identities_across_guid_and_datatype_mismatches)}_{testCase.Name}");
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            $"Collision_{testCase.Name}");

        try {
            if (testCase.AuthorProjectFirst)
                AuthorProjectThenFamily(projectDocument, familyDocument, testCase);
            else
                AuthorFamilyThenProject(projectDocument, familyDocument, testCase);

            var savedFamilyPath =
                RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, testCase.Name);
            var loadedFamily =
                RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);
            Assert.That(loadedFamily, Is.Not.Null,
                $"Case '{testCase.Name}' should load the authored family into the project.");

            var projectProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                .Single(probe => string.Equals(probe.Name, testCase.ProjectSpec.Name, StringComparison.Ordinal));

            var editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            try {
                var familyProbe = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument)
                    .Single(probe => string.Equals(probe.Name, testCase.ProjectSpec.Name, StringComparison.Ordinal));

                Assert.Multiple(() => {
                    Assert.That(projectProbe.IdentityKind, Is.EqualTo(testCase.ExpectedProjectIdentityKind),
                        $"Case '{testCase.Name}' project identity kind");
                    Assert.That(projectProbe.DataTypeId, Is.EqualTo(testCase.ExpectedProjectDataTypeId),
                        $"Case '{testCase.Name}' project datatype");
                    Assert.That(projectProbe.GroupTypeId, Is.EqualTo(testCase.ExpectedProjectGroupTypeId),
                        $"Case '{testCase.Name}' project group");

                    Assert.That(familyProbe.IdentityKind, Is.EqualTo(testCase.ExpectedFamilyIdentityKind),
                        $"Case '{testCase.Name}' family identity kind");
                    Assert.That(familyProbe.DataTypeId, Is.EqualTo(testCase.ExpectedFamilyDataTypeId),
                        $"Case '{testCase.Name}' family datatype");
                    Assert.That(familyProbe.GroupTypeId, Is.EqualTo(testCase.ExpectedFamilyGroupTypeId),
                        $"Case '{testCase.Name}' family group");
                    Assert.That(projectProbe.Name, Is.EqualTo(familyProbe.Name),
                        $"Case '{testCase.Name}' shared display name");

                    if (testCase.ExpectFamilySharedGuid)
                        Assert.That(familyProbe.SharedGuid, Is.Not.Null,
                            $"Case '{testCase.Name}' family shared guid presence");
                    else
                        Assert.That(familyProbe.SharedGuid, Is.Null,
                            $"Case '{testCase.Name}' family shared guid absence");

                    if (testCase.ExpectDistinctSharedGuids) {
                        Assert.That(projectProbe.SharedGuid, Is.Not.Null,
                            $"Case '{testCase.Name}' project shared guid presence");
                        Assert.That(familyProbe.SharedGuid, Is.Not.Null,
                            $"Case '{testCase.Name}' family shared guid presence for comparison");
                        Assert.That(projectProbe.SharedGuid, Is.Not.EqualTo(familyProbe.SharedGuid),
                            $"Case '{testCase.Name}' guid mismatch should prevent merge");
                        Assert.That(projectProbe.IdentityKey,
                            Is.Not.EqualTo($"shared:{familyProbe.SharedGuid!.Value:D}"),
                            $"Case '{testCase.Name}' identity keys should stay distinct");
                    } else
                        Assert.That(projectProbe.SharedGuid, Is.Not.Null,
                            $"Case '{testCase.Name}' project shared guid presence");
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
        CollisionMatrixCase testCase
    ) {
        AuthorProject(projectDocument, testCase.ProjectSpec);
        AuthorFamily(familyDocument, testCase);
    }

    private static void AuthorFamilyThenProject(
        Document projectDocument,
        Document familyDocument,
        CollisionMatrixCase testCase
    ) {
        AuthorFamily(familyDocument, testCase);
        AuthorProject(projectDocument, testCase.ProjectSpec);
    }

    private static void AuthorProject(
        Document projectDocument,
        SharedDefinitionSpec projectSpec
    ) {
        var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, projectSpec);
        RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
            projectDocument,
            projectDefinition,
            true,
            GroupTypeId.IdentityData,
            BuiltInCategory.OST_GenericModel);
    }

    private static void AuthorFamily(
        Document familyDocument,
        CollisionMatrixCase testCase
    ) {
        using var transaction = new Transaction(familyDocument, $"Author collision family parameter {testCase.Name}");
        _ = transaction.Start();

        if (testCase.FamilySharedSpec != null) {
            _ = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                familyDocument,
                testCase.FamilySharedSpec,
                GroupTypeId.IdentityData,
                true);
        }

        if (testCase.FamilyPlainSpec != null)
            _ = RevitFamilyFixtureHarness.AddFamilyParameter(familyDocument, testCase.FamilyPlainSpec);

        _ = transaction.Commit();
    }
}