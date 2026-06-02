namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyFoundryMatrixFixtureTests {
    private Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._dbApplication = uiApplication?.Application
                              ?? throw new InvalidOperationException(
                                  "ricaun.RevitTest did not provide a UIApplication.");

    private Document OpenOldTemplateProjectCopy(string outputDirectory) {
        var projectCopyPath = Path.Combine(outputDirectory, "Old_Template.rvt");
        File.Copy(RevitFamilyFixtureHarness.GetProjectFixturePath("Old_Template.rvt"), projectCopyPath, true);
        return this._dbApplication.OpenDocumentFile(projectCopyPath)
               ?? throw new InvalidOperationException($"Failed to open project fixture copy '{projectCopyPath}'.");
    }

    [Test]
    public void SetValue_matrix_fixture_generates_mechanical_equipment_association_topology() {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.SetValue_matrix_fixture_generates_mechanical_equipment_association_topology));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadSetValueMatrixFamily(
                this._dbApplication,
                projectDocument,
                outputDirectory);

            Assert.That(loadedFamily.Name, Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.SetValueMatrixFamilyName));
            Assert.That(loadedFamily.FamilyCategory?.BuiltInCategory, Is.EqualTo(BuiltInCategory.OST_MechanicalEquipment));

            familyDocument = projectDocument.EditFamily(loadedFamily);
            AssertSetValueMatrixFamilyTopology(familyDocument);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Metadata_state_fixture_generates_parameter_identity_group_and_binding_topology() {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Metadata_state_fixture_generates_parameter_identity_group_and_binding_topology));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadMetadataStateFamily(
                this._dbApplication,
                projectDocument,
                outputDirectory);

            Assert.That(loadedFamily.Name, Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataStateFamilyName));
            Assert.That(loadedFamily.FamilyCategory?.BuiltInCategory, Is.EqualTo(BuiltInCategory.OST_MechanicalEquipment));

            familyDocument = projectDocument.EditFamily(loadedFamily);
            AssertMetadataStateFamilyTopology(familyDocument);
            AssertMetadataProjectBinding(projectDocument);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static void AssertSetValueMatrixFamilyTopology(Document familyDocument) {
        Assert.That(familyDocument.IsFamilyDocument, Is.True);

        var manager = familyDocument.FamilyManager;
        Assert.That(
            manager.Types.Cast<FamilyType>().Select(type => type.Name),
            Is.SupersetOf(FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames));

        var parametersByName = manager.Parameters
            .Cast<FamilyParameter>()
            .ToDictionary(parameter => parameter.Definition.Name, StringComparer.Ordinal);

        Assert.Multiple(() => {
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceText, StorageType.String, SpecTypeId.String.Text);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceFallbackText, StorageType.String, SpecTypeId.String.Text);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceInteger, StorageType.Integer, SpecTypeId.Int.Integer);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceYesNo, StorageType.Integer, SpecTypeId.Boolean.YesNo);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase, StorageType.Double, SpecTypeId.Length);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension, StorageType.Double, SpecTypeId.Angle);
            AssertMatrixParameter(parametersByName, FamilyFoundryMatrixFixtureBuilder.SourceArrayCount, StorageType.Integer, SpecTypeId.Int.Integer);
            Assert.That(parametersByName[FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested].Formula, Is.EqualTo($"{FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase} * 2"));
            Assert.That(parametersByName[FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength].Formula, Is.EqualTo($"{FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase} + 1'"));
        });

        var dimensionLabels = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(Dimension))
            .Cast<Dimension>()
            .Select(GetFamilyLabelName)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToList();
        Assert.That(dimensionLabels, Does.Contain(FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension));
        Assert.That(dimensionLabels, Does.Contain(FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension));
        Assert.That(dimensionLabels, Does.Contain(FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension));

        var arrayLabels = new FilteredElementCollector(familyDocument)
            .OfClass(typeof(BaseArray))
            .Cast<BaseArray>()
            .Select(array => array.Label?.Definition.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .ToList();
        Assert.That(arrayLabels, Does.Contain(FamilyFoundryMatrixFixtureBuilder.SourceArrayCount));

        var nestedInstance = new FilteredElementCollector(familyDocument)
                                 .OfClass(typeof(FamilyInstance))
                                 .Cast<FamilyInstance>()
                                 .FirstOrDefault(instance =>
                                     instance.LookupParameter(FamilyFoundryMatrixFixtureBuilder.NestedWidth) != null)
                             ?? throw new InvalidOperationException("Nested FF matrix instance was not found.");
        var nestedWidth = nestedInstance.LookupParameter(FamilyFoundryMatrixFixtureBuilder.NestedWidth)
                          ?? throw new InvalidOperationException("Nested FF matrix width parameter was not found.");
        var associatedParameter = manager.GetAssociatedFamilyParameter(nestedWidth);
        Assert.That(associatedParameter?.Definition.Name, Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth));
    }

    private static void AssertMetadataStateFamilyTopology(Document familyDocument) {
        Assert.That(familyDocument.IsFamilyDocument, Is.True);

        var manager = familyDocument.FamilyManager;
        Assert.That(
            manager.Types.Cast<FamilyType>().Select(type => type.Name),
            Is.SupersetOf(FamilyFoundryMatrixFixtureBuilder.MetadataTypeNames));

        var parametersByName = manager.Parameters
            .Cast<FamilyParameter>()
            .ToDictionary(parameter => parameter.Definition.Name, StringComparer.Ordinal);

        Assert.Multiple(() => {
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText,
                false,
                false,
                StorageType.String,
                SpecTypeId.String.Text,
                GroupTypeId.Text);
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber,
                false,
                true,
                StorageType.Double,
                SpecTypeId.Number,
                GroupTypeId.IdentityData);
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip,
                false,
                true,
                StorageType.String,
                SpecTypeId.String.Text,
                GroupTypeId.IdentityData);
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText,
                true,
                false,
                StorageType.String,
                SpecTypeId.String.Text,
                GroupTypeId.Text);
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength,
                true,
                true,
                StorageType.Double,
                SpecTypeId.Length,
                GroupTypeId.Geometry);
            AssertMetadataParameter(
                parametersByName,
                FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared,
                true,
                false,
                StorageType.String,
                SpecTypeId.String.Text,
                GroupTypeId.Electrical);

            Assert.That(
                manager.get_Parameter(FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeTextGuid)?.Definition.Name,
                Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText));
            Assert.That(
                manager.get_Parameter(FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLengthGuid)?.Definition.Name,
                Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength));
            Assert.That(
                manager.get_Parameter(FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundSharedGuid)?.Definition.Name,
                Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared));
        });
    }

    private static void AssertMetadataProjectBinding(Document projectDocument) {
        var projectBoundProbe = RevitFamilyFixtureHarness.CollectProjectBindingProbes(projectDocument)
            .Single(probe => probe.SharedGuid == FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundSharedGuid);
        var sharedElement = RevitFamilyFixtureHarness.FindSharedParameterElement(
            projectDocument,
            FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundSharedGuid);

        Assert.Multiple(() => {
            Assert.That(projectBoundProbe.Name, Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared));
            Assert.That(projectBoundProbe.IsShared, Is.True);
            Assert.That(projectBoundProbe.IsInstanceBinding, Is.True);
            Assert.That(projectBoundProbe.GroupTypeId, Is.EqualTo(GroupTypeId.Electrical.TypeId));
            Assert.That(projectBoundProbe.DataTypeId, Is.EqualTo(SpecTypeId.String.Text.TypeId));
            Assert.That(projectBoundProbe.CategoryNames, Does.Contain("Mechanical Equipment"));
            Assert.That(sharedElement, Is.Not.Null);
            Assert.That(sharedElement!.GetDefinition().Name, Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared));
        });
    }

    private static string? GetFamilyLabelName(Dimension dimension) {
        try {
            return dimension.FamilyLabel?.Definition.Name;
        } catch {
            return null;
        }
    }

    private static void AssertMatrixParameter(
        IReadOnlyDictionary<string, FamilyParameter> parametersByName,
        string parameterName,
        StorageType expectedStorageType,
        ForgeTypeId expectedDataType
    ) {
        Assert.That(parametersByName.TryGetValue(parameterName, out var parameter), Is.True, parameterName);
        Assert.That(parameter!.StorageType, Is.EqualTo(expectedStorageType), parameterName);
        Assert.That(parameter.Definition.GetDataType().TypeId, Is.EqualTo(expectedDataType.TypeId), parameterName);
    }

    private static void AssertMetadataParameter(
        IReadOnlyDictionary<string, FamilyParameter> parametersByName,
        string parameterName,
        bool expectedIsShared,
        bool expectedIsInstance,
        StorageType expectedStorageType,
        ForgeTypeId expectedDataType,
        ForgeTypeId expectedGroupTypeId
    ) {
        Assert.That(parametersByName.TryGetValue(parameterName, out var parameter), Is.True, parameterName);
        Assert.That(parameter!.IsShared, Is.EqualTo(expectedIsShared), parameterName);
        Assert.That(parameter.IsInstance, Is.EqualTo(expectedIsInstance), parameterName);
        Assert.That(parameter.StorageType, Is.EqualTo(expectedStorageType), parameterName);
        Assert.That(parameter.Definition.GetDataType().TypeId, Is.EqualTo(expectedDataType.TypeId), parameterName);
        Assert.That(parameter.Definition.GetGroupTypeId().TypeId, Is.EqualTo(expectedGroupTypeId.TypeId), parameterName);
    }
}
