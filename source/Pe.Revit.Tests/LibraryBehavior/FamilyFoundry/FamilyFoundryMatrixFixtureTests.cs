using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamManager;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Shared.RevitData.Families;

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
    public void Public_reconciler_migrates_the_set_value_matrix_and_every_native_reference() {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Public_reconciler_migrates_the_set_value_matrix_and_every_native_reference));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadSetValueMatrixFamily(
                this._dbApplication,
                projectDocument,
                outputDirectory);
            familyDocument = projectDocument.EditFamily(loadedFamily);
            using var processor = new OperationProcessor(familyDocument);
            var patch = SetValueMatrixPatch();
            var operation = new ReconcileFamily(patch);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);

            AssertMigratedMatrixEndState(familyDocument, patch);

            var repeated = new ReconcileFamily(patch);
            var (repeatedContexts, _) = processor.ProcessQueue(new OperationQueue().Add(repeated));
            var (_, repeatedError) = repeatedContexts.Single().OperationLogs;
            Assert.That(repeatedError, Is.Null, repeatedError?.Message);
            Assert.That(repeated.LastReceipt?.Converged, Is.True);
            Assert.That(repeated.LastPlan!.Changes, Is.Empty);
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

    private static FamilyPatch SetValueMatrixPatch() {
        var parameters = new JObject();
        var definitionIndex = 0;
        void Map(string target, ForgeTypeId dataType, string group, bool instance, string[] sources,
            string strategy = "CoerceByStorageType", bool clearFormula = false) {
            var parameter = new JObject {
                ["shared"] = true,
                ["sharedGuid"] = $"33333333-4444-5555-6666-{++definitionIndex:D12}",
                ["sharedSpecId"] = dataType.TypeId,
                ["propertiesGroup"] = group,
                ["isInstance"] = instance,
                ["wasNamed"] = new JArray(sources),
                ["mappingStrategy"] = strategy
            };
            if (clearFormula) parameter["formula"] = JValue.CreateNull();
            parameters[target] = parameter;
        }

        Map(FamilyFoundryMatrixFixtureBuilder.TargetText, SpecTypeId.String.Text, "Text", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber, SpecTypeId.Number, "Identity Data", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceBlankText, FamilyFoundryMatrixFixtureBuilder.SourceFallbackText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetInteger, SpecTypeId.Int.Integer, "Identity Data", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceInteger]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetYesNo, SpecTypeId.Boolean.YesNo, "Identity Data", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceYesNo]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetNumber, SpecTypeId.Number, "Identity Data", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceNumberText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetLength, SpecTypeId.Length, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetVoltage, SpecTypeId.ElectricalPotential, "Electrical", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceVoltageText], "CoerceElectrical");
        Map(FamilyFoundryMatrixFixtureBuilder.TargetCurrent, SpecTypeId.Current, "Electrical", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceCurrentText], "CoerceElectrical");
        Map(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength, SpecTypeId.Length, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested], clearFormula: true);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength, SpecTypeId.Length, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension, SpecTypeId.Length, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension, SpecTypeId.Angle, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension, SpecTypeId.Length, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount, SpecTypeId.Int.Integer, "Geometry", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceArrayCount]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth, SpecTypeId.Length, "Geometry", true,
            [FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth]);
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters } };
    }

    private static void AssertMigratedMatrixEndState(Document familyDocument, FamilyPatch patch) {
        var manager = familyDocument.FamilyManager;
        var types = FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames.Select(name =>
            manager.Types.Cast<FamilyType>().Single(type => type.Name == name)).ToArray();
        FamilyParameter Target(string name) => manager.FindParameter(name)
            ?? throw new InvalidOperationException($"Migrated target '{name}' was not found.");
        static void Doubles(FamilyType[] familyTypes, FamilyParameter parameter, params double[] expected) {
            for (var index = 0; index < familyTypes.Length; index++)
                Assert.That(familyTypes[index].AsDouble(parameter), Is.EqualTo(expected[index]).Within(1e-9),
                    $"{familyTypes[index].Name}/{parameter.Definition.Name}");
        }

        var removedSources = ((JObject)patch.Patch["parameters"]!).Properties()
            .SelectMany(parameter => parameter.Value["wasNamed"]!.Values<string>()).Distinct(StringComparer.Ordinal);
        Assert.That(removedSources.Select(manager.FindParameter), Is.All.Null);

        Assert.Multiple(() => {
            Assert.That(new[] {
                    FamilyFoundryMatrixFixtureBuilder.TargetText,
                    FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber,
                    FamilyFoundryMatrixFixtureBuilder.TargetInteger,
                    FamilyFoundryMatrixFixtureBuilder.TargetYesNo,
                    FamilyFoundryMatrixFixtureBuilder.TargetNumber,
                    FamilyFoundryMatrixFixtureBuilder.TargetLength,
                    FamilyFoundryMatrixFixtureBuilder.TargetVoltage,
                    FamilyFoundryMatrixFixtureBuilder.TargetCurrent,
                    FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength,
                    FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength,
                    FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension,
                    FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension,
                    FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension,
                    FamilyFoundryMatrixFixtureBuilder.TargetArrayCount,
                    FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth
                }.Select(name => Target(name).IsShared), Is.All.True);
            Assert.That(types.Select(type => type.AsString(Target(FamilyFoundryMatrixFixtureBuilder.TargetText))),
                Is.EqualTo(new[] { "matrix-text-1", "matrix-text-2", "matrix-text-3" }));
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber), 20, 21, 22);
            Assert.That(types.Select(type => type.AsInteger(Target(FamilyFoundryMatrixFixtureBuilder.TargetInteger))),
                Is.EqualTo(new int?[] { 2, 3, 4 }));
            Assert.That(types.Select(type => type.AsInteger(Target(FamilyFoundryMatrixFixtureBuilder.TargetYesNo))),
                Is.EqualTo(new int?[] { 1, 0, 1 }));
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetNumber), 42.5, 0, -7.25);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetLength), 1.5, 2.0 / 12.0, 2.5);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetVoltage),
                UnitUtils.ConvertToInternalUnits(208, UnitTypeId.Volts),
                UnitUtils.ConvertToInternalUnits(240, UnitTypeId.Volts),
                UnitUtils.ConvertToInternalUnits(120, UnitTypeId.Volts));
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetCurrent),
                UnitUtils.ConvertToInternalUnits(12, UnitTypeId.Amperes),
                UnitUtils.ConvertToInternalUnits(0, UnitTypeId.Amperes),
                UnitUtils.ConvertToInternalUnits(18.5, UnitTypeId.Amperes));
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength), 2, 4, 6);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength), 2, 3, 4);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension), 2, 3, 4);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension), Math.PI / 4, Math.PI / 5, Math.PI / 6);
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension), .5, 1.5, 2.5);
            Assert.That(types.Select(type => type.AsInteger(Target(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount))),
                Is.EqualTo(new int?[] { 2, 3, 4 }));
            Doubles(types, Target(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth), 1.25, 2.25, 3.25);
            Assert.That(Target(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength).Formula, Is.Null);
            Assert.That(Target(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength).Formula,
                Is.EqualTo($"{FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase} + 1'"));
        });

        var dimensionLabels = new FilteredElementCollector(familyDocument).OfClass(typeof(Dimension)).Cast<Dimension>()
            .Select(GetFamilyLabelName).Where(name => name is not null).ToList();
        Assert.That(dimensionLabels, Does.Contain(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension)
            .And.Contain(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension)
            .And.Contain(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension)
            .And.Not.Contain(FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension)
            .And.Not.Contain(FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension)
            .And.Not.Contain(FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension));

        var arrays = new FilteredElementCollector(familyDocument).OfClass(typeof(BaseArray)).Cast<BaseArray>().ToList();
        Assert.That(arrays.Select(array => array.Label?.Definition.Name),
            Does.Contain(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount)
                .And.Not.Contain(FamilyFoundryMatrixFixtureBuilder.SourceArrayCount));
        var nestedWidth = new FilteredElementCollector(familyDocument).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
            .Select(instance => instance.LookupParameter(FamilyFoundryMatrixFixtureBuilder.NestedWidth)).First(parameter => parameter is not null)!;
        Assert.That(manager.GetAssociatedFamilyParameter(nestedWidth)?.Definition.Name,
            Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth));
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
