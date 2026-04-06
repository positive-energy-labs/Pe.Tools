using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamManager;
using Pe.Shared.RevitData.Parameters;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterCrossDocumentMergeTests {
    [Test]
    public void Shared_parameter_with_same_guid_merges_across_project_and_family_documents_but_can_keep_family_specific_instance_setting(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Shared_parameter_with_same_guid_merges_across_project_and_family_documents_but_can_keep_family_specific_instance_setting));
        var sharedGuid = Guid.NewGuid();
        var sharedSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            Name: "_PE_CrossDoc_SharedGuid",
            DataType: SpecTypeId.String.Text,
            GroupName: "CrossDocMerge",
            Description: "Same shared GUID merge proof.",
            Guid: sharedGuid);
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(Shared_parameter_with_same_guid_merges_across_project_and_family_documents_but_can_keep_family_specific_instance_setting));

        try {
            var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, sharedSpec);
            RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                projectDefinition,
                isInstance: false,
                GroupTypeId.Geometry,
                BuiltInCategory.OST_GenericModel);

            using (var transaction = new Transaction(familyDocument, "Add shared family parameter")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                    familyDocument,
                    sharedSpec,
                    GroupTypeId.IdentityData,
                    isInstance: true);
                _ = transaction.Commit();
            }

            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, "same-guid-before-load");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            try {
                var loadedProbe = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument)
                    .Single(probe => probe.SharedGuid == sharedGuid);
                var projectProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                    .Single(probe => probe.SharedGuid == sharedGuid);

                Assert.Multiple(() => {
                    Assert.That(projectProbe.DefinitionType, Is.EqualTo(nameof(InternalDefinition)));
                    Assert.That(projectProbe.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.SharedGuid)));
                    Assert.That(projectProbe.IsInstanceBinding, Is.False, "Project binding should stay type-bound.");
                    Assert.That(projectProbe.GroupTypeId, Is.EqualTo(GroupTypeId.Geometry.TypeId));

                    Assert.That(loadedProbe.IsShared, Is.True);
                    Assert.That(loadedProbe.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.SharedGuid)));
                    Assert.That(loadedProbe.SharedGuid, Is.EqualTo(sharedGuid));
                    Assert.That(loadedProbe.IsInstance, Is.True, "Family instance/type setting can differ from the project binding.");
                    Assert.That(loadedProbe.GroupTypeId, Is.EqualTo(projectProbe.GroupTypeId), "Shared GUID merge adopts the project-side group metadata in this roundtrip.");
                    Assert.That(loadedProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                });
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(editedFamilyDocument);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Same_name_different_guid_shared_parameters_remain_distinct_across_project_and_family_documents(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Same_name_different_guid_shared_parameters_remain_distinct_across_project_and_family_documents));
        const string parameterName = "_PE_CrossDoc_SameNameDifferentGuid";
        var projectSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            Name: parameterName,
            DataType: SpecTypeId.String.Text,
            GroupName: "CrossDocMerge",
            Description: "Project-side shared parameter.",
            Guid: Guid.NewGuid());
        var familySpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            Name: parameterName,
            DataType: SpecTypeId.String.Text,
            GroupName: "CrossDocMerge",
            Description: "Family-side shared parameter with different GUID.",
            Guid: Guid.NewGuid());
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(Same_name_different_guid_shared_parameters_remain_distinct_across_project_and_family_documents));

        try {
            var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, projectSpec);
            RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                projectDefinition,
                isInstance: true,
                GroupTypeId.IdentityData,
                BuiltInCategory.OST_GenericModel);

            using (var transaction = new Transaction(familyDocument, "Add same-name different-guid shared parameter")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                    familyDocument,
                    familySpec,
                    GroupTypeId.IdentityData,
                    isInstance: true);
                _ = transaction.Commit();
            }

            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, "same-name-different-guid");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            try {
                var familyProbe = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));
                var projectProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));

                Assert.Multiple(() => {
                    Assert.That(projectProbe.SharedGuid, Is.Not.EqualTo(familyProbe.SharedGuid));
                    Assert.That(projectProbe.IdentityKey, Is.Not.EqualTo(familyProbe.SharedGuid.HasValue
                        ? $"shared:{familyProbe.SharedGuid.Value:D}"
                        : string.Empty));
                    Assert.That(projectProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                    Assert.That(familyProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                    Assert.That(projectProbe.Name, Is.EqualTo(familyProbe.Name));
                });
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(editedFamilyDocument);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Same_name_different_datatype_parameters_can_coexist_across_project_and_family_documents(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Same_name_different_datatype_parameters_can_coexist_across_project_and_family_documents));
        const string parameterName = "_PE_CrossDoc_SameNameDifferentDatatype";
        var projectSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            Name: parameterName,
            DataType: SpecTypeId.String.Text,
            GroupName: "CrossDocMerge",
            Description: "Project string parameter.",
            Guid: Guid.NewGuid());
        var familyParameter = new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
            Name: parameterName,
            DataType: SpecTypeId.Length,
            Group: GroupTypeId.Geometry,
            IsInstance: false);
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(Same_name_different_datatype_parameters_can_coexist_across_project_and_family_documents));

        try {
            var projectDefinition = RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, projectSpec);
            RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                projectDefinition,
                isInstance: true,
                GroupTypeId.IdentityData,
                BuiltInCategory.OST_GenericModel);

            using (var transaction = new Transaction(familyDocument, "Add same-name different-datatype family parameter")) {
                _ = transaction.Start();
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(familyDocument, familyParameter);
                _ = transaction.Commit();
            }

            var savedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(familyDocument, outputDirectory, "same-name-different-datatype");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(application, projectDocument, savedFamilyPath);
            Assert.That(loadedFamily, Is.Not.Null);

            var editedFamilyDocument = projectDocument.EditFamily(loadedFamily);
            try {
                var familyProbe = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));
                var projectProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));

                Assert.Multiple(() => {
                    Assert.That(projectProbe.SharedGuid, Is.Not.Null);
                    Assert.That(familyProbe.SharedGuid, Is.Null);
                    Assert.That(projectProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                    Assert.That(familyProbe.DataTypeId, Is.EqualTo(SpecTypeId.Length.TypeId));
                    Assert.That(projectProbe.GroupTypeId, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
                    Assert.That(familyProbe.GroupTypeId, Is.EqualTo(GroupTypeId.Geometry.TypeId));
                    Assert.That(projectProbe.Name, Is.EqualTo(familyProbe.Name));
                });
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(editedFamilyDocument);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Same_named_parameter_can_have_different_properties_in_different_families(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(nameof(Same_named_parameter_can_have_different_properties_in_different_families));
        const string parameterName = "_PE_FamilyDifference_Demo";
        var familyA = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_GenericModel, "FamilyDifference_A");
        var familyB = RevitFamilyFixtureHarness.CreateFamilyDocument(application, BuiltInCategory.OST_GenericModel, "FamilyDifference_B");

        try {
            using (var txA = new Transaction(familyA, "Author family A parameter")) {
                _ = txA.Start();
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyA,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        parameterName,
                        SpecTypeId.Length,
                        GroupTypeId.Geometry,
                        IsInstance: false));
                _ = txA.Commit();
            }

            using (var txB = new Transaction(familyB, "Author family B parameter")) {
                _ = txB.Start();
                _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyB,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        parameterName,
                        SpecTypeId.String.Text,
                        GroupTypeId.IdentityData,
                        IsInstance: true));
                _ = txB.Commit();
            }

            var reopenedFamilyA = RevitFamilyFixtureHarness.ReopenDocument(application, familyA, outputDirectory, "family-difference-a");
            familyA = null!;
            var reopenedFamilyB = RevitFamilyFixtureHarness.ReopenDocument(application, familyB, outputDirectory, "family-difference-b");
            familyB = null!;

            try {
                var probeA = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(reopenedFamilyA)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));
                var probeB = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(reopenedFamilyB)
                    .Single(probe => string.Equals(probe.Name, parameterName, StringComparison.Ordinal));

                Assert.Multiple(() => {
                    Assert.That(probeA.Name, Is.EqualTo(probeB.Name));
                    Assert.That(probeA.DataTypeId, Is.EqualTo(SpecTypeId.Length.TypeId));
                    Assert.That(probeB.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                    Assert.That(probeA.GroupTypeId, Is.EqualTo(GroupTypeId.Geometry.TypeId));
                    Assert.That(probeB.GroupTypeId, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
                    Assert.That(probeA.IsInstance, Is.False);
                    Assert.That(probeB.IsInstance, Is.True);
                    Assert.That(probeA.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.ParameterElement)));
                    Assert.That(probeB.IdentityKind, Is.EqualTo(nameof(RevitParameterIdentityKind.ParameterElement)));
                    Assert.That(probeA.ParameterElementId, Is.Not.Null);
                    Assert.That(probeB.ParameterElementId, Is.Not.Null);
                });
            } finally {
                RevitFamilyFixtureHarness.CloseDocument(reopenedFamilyA);
                RevitFamilyFixtureHarness.CloseDocument(reopenedFamilyB);
            }
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyA);
            RevitFamilyFixtureHarness.CloseDocument(familyB);
        }
    }
}
