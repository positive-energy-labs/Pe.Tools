using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument;
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
            var stages = new JArray();
            var captureIndex = 0;
            FamilyModel CaptureStage(Document document) {
                var names = new[] { "beforeNormalization", "afterNormalization", "afterValueApply" };
                stages.Add(new JObject {
                    ["stage"] = captureIndex < names.Length ? names[captureIndex] : $"unexpected-{captureIndex}",
                    ["currentType"] = document.FamilyManager.CurrentType?.Name,
                    ["typeOrder"] = new JArray(document.FamilyManager.Types.Cast<FamilyType>().Select(type => type.Name)),
                    ["sourceValues"] = NativeMatrixValues(document, MatrixSourceParameters),
                    ["targetValues"] = NativeMatrixValues(document, MatrixTargetParameters)
                });
                captureIndex++;
                return document.CaptureFamilyModel();
            }
            using var processor = new OperationProcessor(familyDocument);
            var patch = SetValueMatrixPatch();
            var operation = new ReconcileFamily(patch, capture: CaptureStage);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            File.WriteAllText(Path.Combine(outputDirectory, "matrix-value-stages.json"), stages.ToString());
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            Assert.That(stages.Select(stage => stage.Value<string>("stage")),
                Is.EqualTo(new[] { "beforeNormalization", "afterNormalization", "afterValueApply" }));
            AssertMatrixStage(stages[0]!["sourceValues"]!, ExpectedSeedMatrix(), "saved/reopened fixture seed");
            AssertMatrixStage(stages[1]!["targetValues"]!, ExpectedTargetMatrix(), "source normalization");
            AssertMatrixStage(stages[2]!["targetValues"]!, ExpectedTargetMatrix(), "explicit value apply");

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

    [TestCase(false, TestName = "SetValue_matrix_fixture_native_array_baseline")]
    [TestCase(true, TestName = "SetValue_matrix_fixture_native_array_with_first_type_selected")]
    public void SetValue_matrix_fixture_preserves_seed_values_across_native_boundaries(bool selectFirstTypeForArrayCreate) {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.SetValue_matrix_fixture_preserves_seed_values_across_native_boundaries));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        var stages = new JArray();
        void Observe(string stage, Document document) => stages.Add(new JObject {
            ["stage"] = stage,
            ["currentType"] = document.FamilyManager.CurrentType?.Name,
            ["values"] = NativeMatrixValues(document, [
                FamilyFoundryMatrixFixtureBuilder.SourceText,
                FamilyFoundryMatrixFixtureBuilder.SourceUnsetText,
                FamilyFoundryMatrixFixtureBuilder.SourceInteger,
                FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension,
                FamilyFoundryMatrixFixtureBuilder.SourceArrayCount
            ]),
            ["hasValues"] = NativeMatrixHasValues(document, [
                FamilyFoundryMatrixFixtureBuilder.SourceText,
                FamilyFoundryMatrixFixtureBuilder.SourceUnsetText,
                FamilyFoundryMatrixFixtureBuilder.SourceInteger,
                FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension,
                FamilyFoundryMatrixFixtureBuilder.SourceArrayCount
            ])
        });

        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadSetValueMatrixFamily(
                this._dbApplication,
                projectDocument,
                outputDirectory,
                Observe,
                selectFirstTypeForArrayCreate);
            familyDocument = projectDocument.EditFamily(loadedFamily);
            Observe("afterLoadEditFamily", familyDocument);
            File.WriteAllText(Path.Combine(outputDirectory,
                $"matrix-seed-boundaries-{(selectFirstTypeForArrayCreate ? "first-type" : "baseline")}.json"), stages.ToString());

            var expectedStages = new List<string> {
                "beforeSeed",
                "beforeSeed:Matrix Type A", "afterSeed:Matrix Type A",
                "beforeSeed:Matrix Type B", "afterSeed:Matrix Type B",
                "beforeSeed:Matrix Type C", "afterSeed:Matrix Type C",
                "beforeTopology",
                "beforeLinearDimensionCreate", "afterLinearDimensionCreate", "afterLinearDimensionLabel",
                "beforeAngularDimensionCreate", "afterAngularDimensionCreate", "afterAngularDimensionLabel",
                "beforeRadialDimensionCreate", "afterRadialDimensionCreate", "afterRadialDimensionLabel",
                "beforeArrayCreate",
            };
            if (selectFirstTypeForArrayCreate)
                expectedStages.Add("beforeArrayCreate:firstType");
            expectedStages.AddRange([
                "afterArrayCreate", "afterArrayLabel",
                "beforeNestedActivate", "afterNestedActivate",
                "beforeNestedCreate", "afterNestedCreate",
                "beforeNestedAssociation", "afterNestedAssociation",
                "afterTopology", "afterRegenerate", "afterCommit",
                "afterSaveAs", "afterReopen", "afterLoadEditFamily"
            ]);
            Assert.That(stages.Select(stage => stage.Value<string>("stage")), Is.EqualTo(expectedStages));
            var beforeArray = stages.Single(stage => stage.Value<string>("stage") == "beforeArrayCreate");
            AssertSeedProbeValues(beforeArray!["values"]!, beforeArray["hasValues"]!);
            if (selectFirstTypeForArrayCreate) {
                Assert.That(stages.Single(item => item.Value<string>("stage") == "beforeArrayCreate:firstType")
                    .Value<string>("currentType"), Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[0]));
                foreach (var stageName in new[] { "afterArrayCreate", "afterArrayLabel", "afterReopen", "afterLoadEditFamily" }) {
                    var stage = stages.Single(item => item.Value<string>("stage") == stageName);
                    AssertSeedProbeValues(stage!["values"]!, stage["hasValues"]!);
                }
            } else {
                var afterArray = stages.Single(stage => stage.Value<string>("stage") == "afterArrayCreate");
                Assert.That(JToken.DeepEquals(afterArray!["values"], beforeArray["values"]), Is.False,
                    "The unchanged native-array path must reproduce the Wave 25 value mutation for this control.");
                var afterLoad = stages.Single(stage => stage.Value<string>("stage") == "afterLoadEditFamily");
                Assert.That(JToken.DeepEquals(afterLoad!["values"], afterArray["values"]), Is.True,
                    "The baseline control mutation must remain observable after save, reopen, load, and family edit.");
                Assert.That(JToken.DeepEquals(afterLoad["hasValues"], afterArray["hasValues"]), Is.True);
            }
            var arrayEvidence = NativeArrayProbe(familyDocument);
            File.WriteAllText(Path.Combine(outputDirectory,
                $"matrix-array-census-{(selectFirstTypeForArrayCreate ? "first-type" : "baseline")}.json"),
                arrayEvidence.ToString());
            Assert.Multiple(() => {
                Assert.That(arrayEvidence.Value<string>("label"),
                    Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.SourceArrayCount));
                Assert.That(arrayEvidence.Value<int>("numMembers"),
                    Is.EqualTo(arrayEvidence["labelValuesByType"]![arrayEvidence.Value<string>("currentType")!]!.Value<int>()),
                    "Installed API semantics require the array member count to be associated with its integer label value.");
                Assert.That(arrayEvidence["originalMemberIds"]!.Concat(arrayEvidence["copiedMemberIds"]!)
                    .Select(item => item.Value<bool>("exists")), Is.All.True);
            });
        } finally {
            var evidencePath = Path.Combine(outputDirectory,
                $"matrix-seed-boundaries-{(selectFirstTypeForArrayCreate ? "first-type" : "baseline")}.json");
            if (stages.Count > 0 && !File.Exists(evidencePath))
                File.WriteAllText(evidencePath, stages.ToString());
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    [Test]
    public void Public_reconciler_rolls_back_the_whole_matrix_when_the_sixteenth_mapping_is_invalid() {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Public_reconciler_rolls_back_the_whole_matrix_when_the_sixteenth_mapping_is_invalid));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadSetValueMatrixFamily(
                this._dbApplication, projectDocument, outputDirectory);
            familyDocument = projectDocument.EditFamily(loadedFamily);
            Assert.That(familyDocument.FamilyManager.FindParameter(FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber), Is.Null,
                "The invalid mapping must exercise conversion into a missing destination.");
            using (var seed = new Transaction(familyDocument, "Seed unparseable sixteenth source")) {
                seed.Start();
                var source = familyDocument.FamilyManager.FindParameter(FamilyFoundryMatrixFixtureBuilder.SourceText)!;
                foreach (var type in familyDocument.FamilyManager.Types.Cast<FamilyType>()) {
                    familyDocument.FamilyManager.CurrentType = type;
                    familyDocument.FamilyManager.Set(source, "not-a-number");
                }
                Assert.That(seed.Commit(), Is.EqualTo(TransactionStatus.Committed));
            }
            var before = familyDocument.CaptureFamilyModel();
            var referencesBefore = NativeReferenceGraph(familyDocument);
            var operation = new ReconcileFamily(SetValueMatrixPatch(includeInvalid: true));
            using var processor = new OperationProcessor(familyDocument);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error?.ToString(), Does.Contain(FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber)
                .And.Contain("All sources failed"));
            Assert.That(operation.LastReceipt?.Converged ?? false, Is.False);
            var after = familyDocument.CaptureFamilyModel();
            Assert.That(FamilyReconciler.Diff(before, after, UnitResolvers.Revit(familyDocument)), Is.Empty);
            Assert.That(FamilyReconciler.Diff(after, before, UnitResolvers.Revit(familyDocument)), Is.Empty);
            Assert.That(NativeReferenceGraph(familyDocument), Is.EqualTo(referencesBefore));
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

    [Test]
    public void Public_reconciler_applies_all_seven_metadata_cases_and_preserves_values() {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            nameof(this.Public_reconciler_applies_all_seven_metadata_cases_and_preserves_values));
        var projectDocument = this.OpenOldTemplateProjectCopy(outputDirectory);
        Document? familyDocument = null;
        try {
            var loadedFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadMetadataStateFamily(
                this._dbApplication, projectDocument, outputDirectory);
            familyDocument = projectDocument.EditFamily(loadedFamily);
            var preservedNames = new[] {
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip,
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText,
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength,
                FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared
            };
            var beforeValues = MetadataValues(familyDocument, preservedNames);
            var operation = new ReconcileFamily(MetadataPatch());
            using var processor = new OperationProcessor(familyDocument);
            var (contexts, _) = processor.ProcessQueue(new OperationQueue().Add(operation));
            var (_, error) = contexts.Single().OperationLogs;
            Assert.That(error, Is.Null, error?.Message);
            Assert.That(operation.LastReceipt?.Converged, Is.True);
            AssertAppliedMetadataEndState(familyDocument, beforeValues);
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

    private static FamilyPatch SetValueMatrixPatch(bool includeInvalid = false) {
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
        Map(FamilyFoundryMatrixFixtureBuilder.TargetLength, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetVoltage, SpecTypeId.ElectricalPotential, "Electrical", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceVoltageText], "CoerceElectrical");
        Map(FamilyFoundryMatrixFixtureBuilder.TargetCurrent, SpecTypeId.Current, "Electrical", false,
            [FamilyFoundryMatrixFixtureBuilder.SourceCurrentText], "CoerceElectrical");
        Map(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested], clearFormula: true);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension, SpecTypeId.Angle, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount, SpecTypeId.Int.Integer, GroupTypeId.Geometry.TypeId, false,
            [FamilyFoundryMatrixFixtureBuilder.SourceArrayCount]);
        Map(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, true,
            [FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth]);
        if (includeInvalid)
            Map(FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber, SpecTypeId.Number, "Identity Data", false,
                [FamilyFoundryMatrixFixtureBuilder.SourceText]);
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters } };
    }

    private static FamilyPatch MetadataPatch() {
        var parameters = new JObject {
            [FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText] = Local("Text", "Text", false),
            [FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber] = Local("Number", "Identity Data", true),
            [FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip] = Local("Text", "Identity Data", true,
                FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltipDescription),
            [FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText] = Shared(
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeTextGuid, SpecTypeId.String.Text, "Text", false),
            [FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength] = Shared(
                FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLengthGuid, SpecTypeId.Length, GroupTypeId.Geometry.TypeId, true),
            [FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared] = Shared(
                FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundSharedGuid, SpecTypeId.String.Text, "Electrical", true),
            [FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText] = Local("Text", "Identity Data", false,
                "Metadata state applied by the matrix migration profile.", "metadata-applied-local-ok")
        };
        return new FamilyPatch { Patch = new JObject { ["parameters"] = parameters } };

        static JObject Local(string dataType, string group, bool instance, string? tooltip = null, string? value = null) {
            var result = new JObject { ["dataType"] = dataType, ["propertiesGroup"] = group, ["isInstance"] = instance };
            if (tooltip is not null) result["tooltip"] = tooltip;
            if (value is not null) result["value"] = value;
            return result;
        }
        static JObject Shared(Guid guid, ForgeTypeId spec, string group, bool instance) => new() {
            ["shared"] = true, ["sharedGuid"] = guid.ToString(), ["sharedSpecId"] = spec.TypeId,
            ["propertiesGroup"] = group, ["isInstance"] = instance
        };
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
            .SelectMany(parameter => parameter.Value["wasNamed"]!.Values<string>().OfType<string>()).Distinct(StringComparer.Ordinal);
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

    private static string[] NativeReferenceGraph(Document familyDocument) {
        var manager = familyDocument.FamilyManager;
        return new FilteredElementCollector(familyDocument).OfClass(typeof(Dimension)).Cast<Dimension>()
            .Select(dimension => $"dimension:{dimension.Id}:{GetFamilyLabelName(dimension)}")
            .Concat(new FilteredElementCollector(familyDocument).OfClass(typeof(BaseArray)).Cast<BaseArray>()
                .Select(array => $"array:{array.Id}:{array.Label?.Definition.Name}"))
            .Concat(new FilteredElementCollector(familyDocument).OfClass(typeof(FamilyInstance)).Cast<FamilyInstance>()
                .Select(instance => instance.LookupParameter(FamilyFoundryMatrixFixtureBuilder.NestedWidth))
                .Where(parameter => parameter is not null)
                .Select(parameter => $"nested:{parameter!.Element.Id}:{manager.GetAssociatedFamilyParameter(parameter)?.Definition.Name}"))
            .OrderBy(value => value, StringComparer.Ordinal).ToArray();
    }

    private static readonly string[] MatrixSourceParameters = [
        FamilyFoundryMatrixFixtureBuilder.SourceText,
        FamilyFoundryMatrixFixtureBuilder.SourceBlankText,
        FamilyFoundryMatrixFixtureBuilder.SourceFallbackText,
        FamilyFoundryMatrixFixtureBuilder.SourceInteger,
        FamilyFoundryMatrixFixtureBuilder.SourceYesNo,
        FamilyFoundryMatrixFixtureBuilder.SourceNumberText,
        FamilyFoundryMatrixFixtureBuilder.SourceLengthText,
        FamilyFoundryMatrixFixtureBuilder.SourceVoltageText,
        FamilyFoundryMatrixFixtureBuilder.SourceCurrentText,
        FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase,
        FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested,
        FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension,
        FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension,
        FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension,
        FamilyFoundryMatrixFixtureBuilder.SourceArrayCount,
        FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth,
        FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength
    ];

    private static readonly string[] MatrixTargetParameters = [
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
    ];

    private static JObject NativeMatrixValues(Document document, IEnumerable<string> parameterNames) {
        var manager = document.FamilyManager;
        var familyDocument = new FamilyDocument(document);
        var values = new JObject();
        foreach (var typeName in FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames) {
            var type = manager.Types.Cast<FamilyType>().Single(item => item.Name == typeName);
            var row = new JObject();
            foreach (var name in parameterNames) {
                var parameter = manager.FindParameter(name);
                var value = parameter is null ? null : familyDocument.GetValue(type, parameter);
                row[name] = value is null ? JValue.CreateNull() : JToken.FromObject(value);
            }
            values[typeName] = row;
        }
        return values;
    }

    private static JObject NativeMatrixHasValues(Document document, IEnumerable<string> parameterNames) {
        var manager = document.FamilyManager;
        var values = new JObject();
        foreach (var typeName in FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames) {
            var type = manager.Types.Cast<FamilyType>().Single(item => item.Name == typeName);
            var row = new JObject();
            foreach (var name in parameterNames)
                row[name] = type.HasValue(manager.FindParameter(name)!);
            values[typeName] = row;
        }
        return values;
    }

    private static JObject ExpectedSeedMatrix() => ExpectedMatrix((index, row) => {
        row[FamilyFoundryMatrixFixtureBuilder.SourceText] = $"matrix-text-{index + 1}";
        row[FamilyFoundryMatrixFixtureBuilder.SourceBlankText] = "";
        row[FamilyFoundryMatrixFixtureBuilder.SourceFallbackText] = (index + 20).ToString();
        row[FamilyFoundryMatrixFixtureBuilder.SourceInteger] = index + 2;
        row[FamilyFoundryMatrixFixtureBuilder.SourceYesNo] = index % 2 == 0 ? 1 : 0;
        row[FamilyFoundryMatrixFixtureBuilder.SourceNumberText] = index == 0 ? "42.5" : index == 1 ? "0" : "-7.25";
        row[FamilyFoundryMatrixFixtureBuilder.SourceLengthText] = index == 0 ? "18 in" : index == 1 ? "2\"" : "2' - 6\"";
        row[FamilyFoundryMatrixFixtureBuilder.SourceVoltageText] = index == 0 ? "208V" : index == 1 ? "240 V" : "120V";
        row[FamilyFoundryMatrixFixtureBuilder.SourceCurrentText] = index == 0 ? "12 A" : index == 1 ? "0 A" : "18.5 A";
        row[FamilyFoundryMatrixFixtureBuilder.SourceFormulaBase] = index + 1d;
        row[FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested] = (index + 1d) * 2;
        row[FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension] = index + 2d;
        row[FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension] = Math.PI / (index + 4);
        row[FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension] = .5 + index;
        row[FamilyFoundryMatrixFixtureBuilder.SourceArrayCount] = index + 2;
        row[FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth] = 1.25 + index;
        row[FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength] = index + 2d;
    });

    private static void AssertSeedProbeValues(JToken values, JToken hasValues) {
        for (var index = 0; index < FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames.Length; index++) {
            var typeName = FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[index];
            var row = values[typeName]!;
            var hasValue = hasValues[typeName]!;
            Assert.Multiple(() => {
                Assert.That(row.Value<string>(FamilyFoundryMatrixFixtureBuilder.SourceText),
                    Is.EqualTo($"matrix-text-{index + 1}"));
                Assert.That(row.Value<int>(FamilyFoundryMatrixFixtureBuilder.SourceInteger), Is.EqualTo(index + 2));
                Assert.That(row.Value<double>(FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension),
                    Is.EqualTo(.5 + index).Within(1e-9));
                Assert.That(row.Value<int>(FamilyFoundryMatrixFixtureBuilder.SourceArrayCount), Is.EqualTo(index + 2));
                Assert.That(hasValue.Value<bool>(FamilyFoundryMatrixFixtureBuilder.SourceText), Is.True);
                Assert.That(hasValue.Value<bool>(FamilyFoundryMatrixFixtureBuilder.SourceInteger), Is.True);
                Assert.That(hasValue.Value<bool>(FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension), Is.True);
                Assert.That(hasValue.Value<bool>(FamilyFoundryMatrixFixtureBuilder.SourceArrayCount), Is.True);
                Assert.That(hasValue.Value<bool>(FamilyFoundryMatrixFixtureBuilder.SourceUnsetText), Is.False);
                Assert.That(row[FamilyFoundryMatrixFixtureBuilder.SourceUnsetText]!.Type, Is.EqualTo(JTokenType.Null));
            });
        }
    }

    private static JObject NativeArrayProbe(Document document) {
        var array = new FilteredElementCollector(document).OfClass(typeof(LinearArray)).Cast<LinearArray>().Single();
        var manager = document.FamilyManager;
        var label = array.Label ?? throw new InvalidOperationException("The persisted array has no label.");
        JArray Members(IEnumerable<ElementId> ids) => new(ids.Select(id => new JObject {
            ["id"] = id.Value(),
            ["exists"] = document.GetElement(id) is not null,
            ["kind"] = document.GetElement(id)?.GetType().Name
        }));
        return new JObject {
            ["numMembers"] = array.NumMembers,
            ["label"] = label.Definition.Name,
            ["currentType"] = manager.CurrentType?.Name,
            ["labelValuesByType"] = new JObject(manager.Types.Cast<FamilyType>().Select(type =>
                new JProperty(type.Name, type.HasValue(label) ? type.AsInteger(label) : null))),
            ["originalMemberIds"] = Members(array.GetOriginalMemberIds()),
            ["copiedMemberIds"] = Members(array.GetCopiedMemberIds())
        };
    }

    private static JObject ExpectedTargetMatrix() => ExpectedMatrix((index, row) => {
        row[FamilyFoundryMatrixFixtureBuilder.TargetText] = $"matrix-text-{index + 1}";
        row[FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber] = index + 20d;
        row[FamilyFoundryMatrixFixtureBuilder.TargetInteger] = index + 2;
        row[FamilyFoundryMatrixFixtureBuilder.TargetYesNo] = index % 2 == 0 ? 1 : 0;
        row[FamilyFoundryMatrixFixtureBuilder.TargetNumber] = index == 0 ? 42.5 : index == 1 ? 0 : -7.25;
        row[FamilyFoundryMatrixFixtureBuilder.TargetLength] = index == 0 ? 1.5 : index == 1 ? 2d / 12 : 2.5;
        row[FamilyFoundryMatrixFixtureBuilder.TargetVoltage] = UnitUtils.ConvertToInternalUnits(index == 0 ? 208 : index == 1 ? 240 : 120, UnitTypeId.Volts);
        row[FamilyFoundryMatrixFixtureBuilder.TargetCurrent] = UnitUtils.ConvertToInternalUnits(index == 0 ? 12 : index == 1 ? 0 : 18.5, UnitTypeId.Amperes);
        row[FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength] = (index + 1d) * 2;
        row[FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength] = index + 2d;
        row[FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension] = index + 2d;
        row[FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension] = Math.PI / (index + 4);
        row[FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension] = .5 + index;
        row[FamilyFoundryMatrixFixtureBuilder.TargetArrayCount] = index + 2;
        row[FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth] = 1.25 + index;
    });

    private static JObject ExpectedMatrix(Action<int, JObject> populate) {
        var values = new JObject();
        for (var index = 0; index < FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames.Length; index++) {
            var row = new JObject();
            populate(index, row);
            values[FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[index]] = row;
        }
        return values;
    }

    private static void AssertMatrixStage(JToken actual, JToken expected, string stage) =>
        Assert.That(JToken.DeepEquals(actual, expected), Is.True,
            $"Native {stage} values differ. Expected: {expected} Actual: {actual}");

    private static Dictionary<string, object?> MetadataValues(Document familyDocument, IEnumerable<string> names) {
        var manager = familyDocument.FamilyManager;
        var document = new FamilyDocument(familyDocument);
        var values = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var typeName in FamilyFoundryMatrixFixtureBuilder.MetadataTypeNames) {
            var type = manager.Types.Cast<FamilyType>().Single(item => item.Name == typeName);
            foreach (var name in names) {
                var parameter = manager.FindParameter(name)
                    ?? throw new InvalidOperationException($"Metadata parameter '{name}' was not found.");
                values[$"{typeName}/{name}"] = document.GetValue(type, parameter);
            }
        }
        return values;
    }

    private static void AssertAppliedMetadataEndState(Document familyDocument, IReadOnlyDictionary<string, object?> beforeValues) {
        var manager = familyDocument.FamilyManager;
        var parameters = manager.Parameters.Cast<FamilyParameter>()
            .ToDictionary(parameter => parameter.Definition.Name, StringComparer.Ordinal);
        Assert.Multiple(() => {
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText,
                false, false, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber,
                false, true, StorageType.Double, SpecTypeId.Number, GroupTypeId.IdentityData);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip,
                false, true, StorageType.String, SpecTypeId.String.Text, GroupTypeId.IdentityData);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText,
                true, false, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength,
                true, true, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared,
                true, true, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Electrical);
            AssertMetadataParameter(parameters, FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText,
                false, false, StorageType.String, SpecTypeId.String.Text, GroupTypeId.IdentityData);
        });
        Assert.That(MetadataValues(familyDocument, beforeValues.Keys.Select(key => key[(key.IndexOf('/') + 1)..]).Distinct()),
            Is.EqualTo(beforeValues));
        foreach (var typeName in FamilyFoundryMatrixFixtureBuilder.MetadataTypeNames) {
            var type = manager.Types.Cast<FamilyType>().Single(item => item.Name == typeName);
            Assert.That(type.AsString(parameters[FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText]),
                Is.EqualTo("metadata-applied-local-ok"));
        }
        var captured = familyDocument.CaptureFamilyModel();
        Assert.That(captured.Parameters[FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip].Tooltip,
            Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltipDescription));
        Assert.That(captured.Parameters[FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText].Tooltip,
            Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeTextDescription));
        Assert.That(captured.Parameters[FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength].Tooltip,
            Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLengthDescription));
        Assert.That(captured.Parameters[FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared].Tooltip,
            Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundSharedDescription));
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
