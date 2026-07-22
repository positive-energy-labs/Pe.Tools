using Newtonsoft.Json.Linq;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.Global.Services.Aps;
using Pe.Shared.RevitData;
using Pe.Shared.StorageRuntime;
using ParamModel = Pe.Revit.Global.Services.Aps.ParametersApi.Parameters;
using ParamModelRes = Pe.Revit.Global.Services.Aps.ParametersApi.Parameters.ParametersResult;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class DesiredFamilyMigrationProfileTests {
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string DesiredParametersFixture = "desired-single-family-parameters.json";
    private const string DesiredMigrationFamilyName = "FF-Test-DesiredMigrationParameters";
    private static readonly Guid TestSharedParameterGuid = new("11111111-2222-3333-4444-555555555555");

    private Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._dbApplication = uiApplication?.Application
                              ?? throw new InvalidOperationException(
                                  "ricaun.RevitTest did not provide a UIApplication.");

    [Test]
    public void Desired_migration_profile_roundtrips_and_compiles_reconciliation_plan() {
        var profile = RevitFamilyFixtureHarness.LoadDesiredMigrationProfileFixture(DesiredParametersFixture);
        using var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            TestFamilyCategory,
            $"{DesiredMigrationFamilyName}-Plan");
        using var tempSharedParamFile = new TempSharedParamFile(familyDocument);
        var sharedParameter = CreateTestSharedParameterDefinition(tempSharedParamFile);
        var plan = DesiredParameterCompiler.Compile(profile, profile, [sharedParameter], profile.MappingData);

        Assert.Multiple(() => {
            Assert.That(plan.Parameters, Has.Count.EqualTo(5));
            Assert.That(plan.RequiredApsParameterNames, Is.EquivalentTo(new[] { "PE_FF_TestSharedValue" }));
            Assert.That(plan.FamilyParameterNames, Is.EquivalentTo(new[] {
                "Desired Double Height",
                "Desired Height",
                "Desired Note",
                "Desired Width"
            }));
            Assert.That(plan.LoweredActions.Select(action => action.Operation),
                Does.Contain("AddFamilyParams")
                    .And.Contain("AddAndMapSharedParams")
                    .And.Contain("SetKnownParams")
                    .And.Contain("ParamDrivenSolids"));
        });

        var widthAction = plan.LoweredActions.Single(action =>
            action.Operation == "AddFamilyParams" &&
            string.Equals(action.Target, "Desired Width", StringComparison.Ordinal));
        Assert.That(widthAction.Sources, Is.Empty);

        var sharedParameterPlan = plan.Parameters.Single(parameter => parameter.Definition.Name == "PE_FF_TestSharedValue");
        Assert.Multiple(() => {
            Assert.That(sharedParameterPlan.Provenance.Identity,
                Is.EqualTo(ResolvedParameterMetadataProvenance.ParameterService));
            Assert.That(sharedParameterPlan.Provenance.DataType,
                Is.EqualTo(ResolvedParameterMetadataProvenance.ParameterService));
            Assert.That(sharedParameterPlan.Provenance.PropertiesGroup,
                Is.EqualTo(ResolvedParameterMetadataProvenance.Authored));
            Assert.That(sharedParameterPlan.Provenance.IsInstance,
                Is.EqualTo(ResolvedParameterMetadataProvenance.Authored));
        });
    }

    [Test]
    public void Desired_migration_compiler_rejects_shared_target_without_resolved_definition() {
        var profile = new DesiredFamilyMigrationProfile {
            SharedParameters = [
                new DesiredSharedParameterDeclaration {
                    Name = "External Shared Value",
                    Value = "identity-ok"
                }
            ]
        };

        var ex = Assert.Throws<InvalidOperationException>(() =>
            DesiredParameterCompiler.Compile(profile, profile, [], profile.MappingData));

        Assert.That(ex!.Message, Does.Contain("Shared parameter 'External Shared Value' was requested"));
    }

    [Test]
    public void Desired_migration_profile_applies_local_parameter_state_to_single_family_document() {
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            TestFamilyCategory,
            DesiredMigrationFamilyName);
        Document? savedDocument = null;
        using var parameterCacheRestore = SeedTestParameterServiceCache();

        try {
            SeedFamilyTypesAndLegacyParameter(familyDocument);

            var profile = RevitFamilyFixtureHarness.LoadDesiredMigrationProfileFixture(DesiredParametersFixture);
            var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(this.Desired_migration_profile_applies_local_parameter_state_to_single_family_document));
            var result = familyDocument.ApplyDesiredFamilyMigrationProfile(
                profile,
                DesiredParametersFixture,
                onFinishSettings: new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = false,
                    SaveFamilyToInternalPath = true,
                    SaveFamilyToOutputDir = true
                },
                runOutput: OutputStorage.ExactDir(outputDirectory));

            Assert.That(result.Success, Is.True, result.Error);
            Assert.That(result.FamilyCount, Is.EqualTo(1));
            Assert.That(result.OutputFolderPath, Is.Not.Null.And.Not.Empty);

            var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
            var desiredPlanPath = Path.Combine(result.OutputFolderPath!, DesiredMigrationFamilyName,
                "desired-migration-plan.json");
            Assert.Multiple(() => {
                Assert.That(File.Exists(savedFamilyPath), Is.True, savedFamilyPath);
                Assert.That(File.Exists(desiredPlanPath), Is.True, desiredPlanPath);
            });

            var emittedPlan = JObject.Parse(File.ReadAllText(desiredPlanPath));
            var emittedSharedParameter = emittedPlan["Parameters"]!.Single(parameter =>
                string.Equals((string?)parameter["Definition"]?["Name"], "PE_FF_TestSharedValue", StringComparison.Ordinal));
            var emittedWidthAction = emittedPlan["LoweredActions"]!.Single(action =>
                string.Equals((string?)action["Operation"], "AddFamilyParams", StringComparison.Ordinal) &&
                string.Equals((string?)action["Target"], "Desired Width", StringComparison.Ordinal));
            Assert.Multiple(() => {
                Assert.That((string?)emittedSharedParameter["Provenance"]!["Identity"], Is.EqualTo("ParameterService"));
                Assert.That((string?)emittedSharedParameter["Provenance"]!["DataType"], Is.EqualTo("ParameterService"));
                Assert.That(emittedWidthAction["Sources"]!.Select(source => (string?)source), Is.Empty);
                Assert.That(emittedPlan["LoweredActions"]!.Any(action =>
                    string.Equals((string?)action["Operation"], "SetKnownParams", StringComparison.Ordinal) &&
                    string.Equals((string?)action["Target"], "Desired Width", StringComparison.Ordinal)), Is.True);
                Assert.That(emittedPlan["LoweredActions"]!.Any(action =>
                    string.Equals((string?)action["Operation"], "ParamDrivenSolids", StringComparison.Ordinal)), Is.True);
            });

            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            familyDocument = null!;
            savedDocument = this._dbApplication.OpenDocumentFile(savedFamilyPath);

            var probes = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(savedDocument);
            Assert.Multiple(() => {
                Assert.That(probes.Single(probe => probe.Name == "Desired Width").IsInstance, Is.False);
                Assert.That(probes.Single(probe => probe.Name == "Desired Width").DataTypeId,
                    Is.EqualTo(SpecTypeId.Length.TypeId));
                Assert.That(probes.Single(probe => probe.Name == "Desired Double Height").Formula,
                    Is.EqualTo("Desired Height * 2"));
                Assert.That(probes.Single(probe => probe.Name == "Desired Note").DataTypeId,
                    Is.EqualTo(SpecTypeId.String.Text.TypeId));
                Assert.That(probes.Single(probe => probe.Name == "PE_FF_TestSharedValue").IsShared, Is.True);
            });

            using var snapshotTransaction = new Transaction(savedDocument, "Capture desired migration parameter values");
            _ = snapshotTransaction.Start();
            var widthValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                savedDocument,
                "Desired Width",
                ["Small", "Large"]);
            var heightValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                savedDocument,
                "Desired Height",
                ["Small"]);
            var doubleHeightValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                savedDocument,
                "Desired Double Height",
                ["Small"]);
            var noteValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                savedDocument,
                "Desired Note",
                ["Small"]);
            var sharedValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                savedDocument,
                "PE_FF_TestSharedValue",
                ["Small"]);
            _ = snapshotTransaction.RollBack();

            Assert.Multiple(() => {
                Assert.That((double)widthValues.Single(value => value.TypeName == "Small").RawValue!,
                    Is.EqualTo(3.0).Within(0.0001));
                Assert.That((double)widthValues.Single(value => value.TypeName == "Large").RawValue!,
                    Is.EqualTo(4.0).Within(0.0001));
                Assert.That((double)heightValues.Single().RawValue!, Is.EqualTo(0.5).Within(0.0001));
                Assert.That((double)doubleHeightValues.Single().RawValue!, Is.EqualTo(1.0).Within(0.0001));
                Assert.That(noteValues.Single().RawValue, Is.EqualTo("desired-ok"));
                Assert.That(sharedValues.Single().RawValue, Is.EqualTo("shared-ok"));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(savedDocument);
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    [Test]
    public void Desired_migration_profile_processes_selected_family_from_project_document() {
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(this._dbApplication);
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            this._dbApplication,
            TestFamilyCategory,
            $"{DesiredMigrationFamilyName}-Project");
        Document? editedFamilyDocument = null;
        using var parameterCacheRestore = SeedTestParameterServiceCache();

        try {
            SeedFamilyTypesAndLegacyParameter(familyDocument);
            var seedDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                nameof(this.Desired_migration_profile_processes_selected_family_from_project_document));
            var seedFamilyPath = RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                seedDirectory,
                $"{DesiredMigrationFamilyName}-Project");
            var loadedFamily = RevitFamilyFixtureHarness.LoadFamilyIntoProject(
                this._dbApplication,
                projectDocument,
                seedFamilyPath);
            var loadedFamilyName = loadedFamily.Name;

            var profile = RevitFamilyFixtureHarness.LoadDesiredMigrationProfileFixture(DesiredParametersFixture);
            var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
                $"{nameof(this.Desired_migration_profile_processes_selected_family_from_project_document)}-apply");
            var result = projectDocument.ApplyDesiredFamilyMigrationProfile(
                profile,
                DesiredParametersFixture,
                selectedFamilies: [loadedFamily],
                onFinishSettings: new LoadAndSaveOptions {
                    OpenOutputFilesOnCommandFinish = false,
                    LoadFamily = true,
                    SaveFamilyToInternalPath = false,
                    SaveFamilyToOutputDir = true
                },
                runOutput: OutputStorage.ExactDir(outputDirectory));

            Assert.That(result.Success, Is.True, result.Error);
            Assert.That(result.FamilyCount, Is.EqualTo(1));
            Assert.That(result.ProcessedFamilyNames, Is.EquivalentTo(new[] { loadedFamilyName }));
            Assert.That(result.OutputFolderPath, Is.Not.Null.And.Not.Empty);
            Assert.That(
                File.Exists(Path.Combine(result.OutputFolderPath!, loadedFamilyName, "desired-migration-plan.json")),
                Is.True);

            var reloadedFamily = new FilteredElementCollector(projectDocument)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Single(family => family.Name == loadedFamilyName);
            editedFamilyDocument = projectDocument.EditFamily(reloadedFamily);
            var probes = RevitFamilyFixtureHarness.CollectFamilyParameterProbes(editedFamilyDocument);
            Assert.Multiple(() => {
                Assert.That(probes.Single(probe => probe.Name == "Desired Width").DataTypeId,
                    Is.EqualTo(SpecTypeId.Length.TypeId));
                Assert.That(probes.Single(probe => probe.Name == "PE_FF_TestSharedValue").IsShared, Is.True);
            });

            using var snapshotTransaction = new Transaction(editedFamilyDocument, "Capture project desired migration values");
            _ = snapshotTransaction.Start();
            var widthValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                editedFamilyDocument,
                "Desired Width",
                ["Small", "Large"]);
            var sharedValues = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                editedFamilyDocument,
                "PE_FF_TestSharedValue",
                ["Small"]);
            _ = snapshotTransaction.RollBack();

            Assert.Multiple(() => {
                Assert.That((double)widthValues.Single(value => value.TypeName == "Small").RawValue!,
                    Is.EqualTo(3.0).Within(0.0001));
                Assert.That((double)widthValues.Single(value => value.TypeName == "Large").RawValue!,
                    Is.EqualTo(4.0).Within(0.0001));
                Assert.That(sharedValues.Single().RawValue, Is.EqualTo("shared-ok"));
            });
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(editedFamilyDocument);
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private static IDisposable SeedTestParameterServiceCache() {
        var cache = StorageClient.Default.Global().State().Json<ParamModel>("parameters-service-cache");
        var cachePath = ((Pe.Shared.StorageRuntime.Json.JsonReader<ParamModel>)cache).FilePath;
        var cacheExisted = File.Exists(cachePath);
        var originalCacheContent = cacheExisted ? File.ReadAllText(cachePath) : null;
        _ = cache.Write(new ParamModel {
            Results = [
                new ParamModelRes {
                    Id = $"autodesk.revit.parameter:{TestSharedParameterGuid}-1.0.0",
                    Name = "PE_FF_TestSharedValue",
                    Description = "Desired migration shared parameter fixture.",
                    SpecId = SpecTypeId.String.Text.TypeId,
                    ValueTypeId = SpecTypeId.String.Text.TypeId,
                    Metadata = [
                        new ParamModelRes.RawMetadataValue { Id = "isHidden", Value = false },
                        new ParamModelRes.RawMetadataValue { Id = "instanceTypeAssociation", Value = "TYPE" },
                        new ParamModelRes.RawMetadataValue {
                            Id = "group",
                            Value = new ParamModelRes.ParameterDownloadOpts.MetadataBinding {
                                Id = GroupTypeId.IdentityData.TypeId
                            }
                        }
                    ]
                }
            ]
        });
        return new ParameterServiceCacheRestore(cachePath, cacheExisted, originalCacheContent);
    }

    private sealed class ParameterServiceCacheRestore(
        string filePath,
        bool cacheExisted,
        string? originalCacheContent) : IDisposable {
        public void Dispose() {
            if (cacheExisted) {
                File.WriteAllText(filePath, originalCacheContent ?? string.Empty);
                return;
            }

            if (File.Exists(filePath))
                File.Delete(filePath);
        }
    }

    private static void SeedFamilyTypesAndLegacyParameter(Document familyDocument) {
        using var transaction = new Transaction(familyDocument, "Seed desired migration test family");
        _ = transaction.Start();

        _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Small");
        _ = RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, "Large");
        var legacyWidth = RevitFamilyFixtureHarness.AddFamilyParameter(
            familyDocument,
            new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                "Legacy Width",
                SpecTypeId.Length,
                GroupTypeId.Geometry,
                false));
        var familyManager = familyDocument.FamilyManager;
        familyManager.CurrentType = familyManager.Types.Cast<FamilyType>().Single(type => type.Name == "Small");
        familyManager.Set(legacyWidth, 3.0);
        familyManager.CurrentType = familyManager.Types.Cast<FamilyType>().Single(type => type.Name == "Large");
        familyManager.Set(legacyWidth, 4.0);

        _ = transaction.Commit();
    }

    private static SharedParameterDefinition CreateTestSharedParameterDefinition(TempSharedParamFile tempSharedParamFile) {
        var definition = SharedParameterBinder.EnsureDefinition(tempSharedParamFile, new SharedDefinitionSpec(
            "PE_FF_TestSharedValue",
            SpecTypeId.String.Text,
            Description: "Desired migration shared parameter fixture.",
            Guid: TestSharedParameterGuid));
        return new SharedParameterDefinition(definition, GroupTypeId.IdentityData, false);
    }
}
