using Pe.Revit.Extensions.FamManager;
using Pe.Revit.DocumentData.Parameters;
namespace Pe.Revit.Tests;

[TestFixture]
public sealed class ParameterDefinitionResolutionTests {
    private const string SharedParameterName = "_PE_DefinitionResolution_Shared";

    [Test]
    public void Project_binding_resolution_prefers_internal_definition_identity_and_preserves_shared_guid(
        UIApplication uiApplication) {
        var application = uiApplication.Application;
        var sharedGuid = Guid.NewGuid();
        var externalSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            SharedParameterName,
            SpecTypeId.String.Text,
            "DefinitionResolution",
            "Definition resolution proof shared parameter.",
            sharedGuid);
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(application);

        try {
            var externalDefinition =
                RevitFamilyFixtureHarness.CreateSharedParameterDefinition(projectDocument, externalSpec);
            Assert.That(externalDefinition.GUID, Is.EqualTo(sharedGuid));

            var before = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                .Where(probe => string.Equals(probe.Name, SharedParameterName, StringComparison.Ordinal))
                .ToArray();
            Assert.That(before, Is.Empty);

            var insert = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                externalDefinition,
                true,
                GroupTypeId.IdentityData,
                BuiltInCategory.OST_MechanicalEquipment);

            Assert.Multiple(() => {
                Assert.That(insert.DefinitionExisted, Is.False);
                Assert.That(insert.BindingSucceeded, Is.True);
                Assert.That(insert.ProvidedDefinitionType, Is.EqualTo(nameof(ExternalDefinition)));
            });

            var sharedElement = RevitFamilyFixtureHarness.FindSharedParameterElement(projectDocument, sharedGuid);
            Assert.That(sharedElement, Is.Not.Null, "Expected shared parameter element after first binding insert.");

            var probesAfterInsert = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                .Where(probe => probe.SharedGuid == sharedGuid)
                .ToArray();
            Assert.That(probesAfterInsert, Has.Length.EqualTo(1));

            var insertedProbe = probesAfterInsert[0];
            Assert.Multiple(() => {
                Assert.That(insertedProbe.DefinitionType, Is.EqualTo(nameof(InternalDefinition)));
                Assert.That(insertedProbe.IdentityKind, Is.EqualTo(nameof(ParameterIdentityKind.SharedGuid)));
                Assert.That(insertedProbe.IsShared, Is.True);
                Assert.That(insertedProbe.IsInstanceBinding, Is.True);
                Assert.That(insertedProbe.GroupTypeId, Is.EqualTo(GroupTypeId.IdentityData.TypeId));
                Assert.That(insertedProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
                Assert.That(insertedProbe.CategoryNames, Is.EqualTo(new[] { "Mechanical Equipment" }));
            });

            var internalDefinition = sharedElement!.GetDefinition();
            Assert.That(internalDefinition, Is.TypeOf<InternalDefinition>());

            var reinsert = RevitFamilyFixtureHarness.AddOrUpdateProjectParameterBinding(
                projectDocument,
                internalDefinition,
                false,
                GroupTypeId.Geometry,
                BuiltInCategory.OST_PlumbingEquipment);

            Assert.Multiple(() => {
                Assert.That(reinsert.DefinitionExisted, Is.True);
                Assert.That(reinsert.BindingSucceeded, Is.True);
                Assert.That(reinsert.ProvidedDefinitionType, Is.EqualTo(nameof(InternalDefinition)));
            });

            var probesAfterReinsert = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
                .Where(probe => probe.SharedGuid == sharedGuid)
                .ToArray();
            Assert.That(probesAfterReinsert, Has.Length.EqualTo(1));

            var reinsertedProbe = probesAfterReinsert[0];
            Assert.Multiple(() => {
                Assert.That(reinsertedProbe.DefinitionType, Is.EqualTo(nameof(InternalDefinition)));
                Assert.That(reinsertedProbe.IdentityKey, Is.EqualTo(insertedProbe.IdentityKey));
                Assert.That(reinsertedProbe.IdentityKind, Is.EqualTo(nameof(ParameterIdentityKind.SharedGuid)));
                Assert.That(reinsertedProbe.IsInstanceBinding, Is.False);
                Assert.That(reinsertedProbe.GroupTypeId, Is.EqualTo(GroupTypeId.Geometry.TypeId));
                Assert.That(reinsertedProbe.CategoryNames, Is.EqualTo(new[] { "Plumbing Equipment" }));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Shared_family_parameter_resolution_is_guid_stable_and_stays_family_scoped(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var sharedGuid = Guid.NewGuid();
        var sharedSpec = new RevitFamilyFixtureHarness.SharedDefinitionSpec(
            "_PE_FamilyScoped_Shared",
            SpecTypeId.String.Text,
            "DefinitionResolution",
            "Family-scoped shared parameter proof.",
            sharedGuid);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(this.Shared_family_parameter_resolution_is_guid_stable_and_stays_family_scoped));

        try {
            using var transaction = new Transaction(familyDocument, "Add shared family parameter");
            _ = transaction.Start();
            var familyParameter = RevitFamilyFixtureHarness.AddSharedFamilyParameter(
                familyDocument,
                sharedSpec,
                GroupTypeId.IdentityData);
            _ = transaction.Commit();

            var resolvedByGuid = RevitFamilyFixtureHarness.FindSharedFamilyParameter(familyDocument, sharedGuid);
            var identity = ParameterIdentityFactory.FromFamilyParameter(familyParameter);

            Assert.Multiple(() => {
                Assert.That(familyParameter.IsShared, Is.True);
                Assert.That(familyParameter.Definition.Name, Is.EqualTo(sharedSpec.Name));
                Assert.That(resolvedByGuid, Is.Not.Null);
                Assert.That(resolvedByGuid!.Definition.Name, Is.EqualTo(familyParameter.Definition.Name));
                Assert.That(resolvedByGuid.IsShared, Is.True);
                Assert.That(identity.Kind, Is.EqualTo(ParameterIdentityKind.SharedGuid));
                Assert.That(identity.SharedGuid, Is.EqualTo(sharedGuid));
                Assert.That(identity.Name, Is.EqualTo(sharedSpec.Name));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void Plain_family_parameter_resolution_falls_back_to_name_identity(UIApplication uiApplication) {
        var application = uiApplication.Application;
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            application,
            BuiltInCategory.OST_GenericModel,
            nameof(this.Plain_family_parameter_resolution_falls_back_to_name_identity));

        try {
            FamilyParameter familyParameter;
            using (var transaction = new Transaction(familyDocument, "Add plain family parameter")) {
                _ = transaction.Start();
                familyParameter = RevitFamilyFixtureHarness.AddFamilyParameter(
                    familyDocument,
                    new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                        "_PE_FamilyScoped_Plain",
                        SpecTypeId.Length,
                        GroupTypeId.Geometry,
                        false));
                _ = transaction.Commit();
            }

            var resolvedByName = familyDocument.FamilyManager.FindParameter("_PE_FamilyScoped_Plain");
            var identity = ParameterIdentityFactory.FromFamilyParameter(familyParameter);

            Assert.Multiple(() => {
                Assert.That(familyParameter.IsShared, Is.False);
                Assert.That(resolvedByName, Is.Not.Null);
                Assert.That(resolvedByName!.Definition.Name, Is.EqualTo(familyParameter.Definition.Name));
                Assert.That(identity.Kind, Is.EqualTo(ParameterIdentityKind.ParameterElement));
                Assert.That(identity.SharedGuid, Is.Null);
                Assert.That(identity.Name, Is.EqualTo("_PE_FamilyScoped_Plain"));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }
}
