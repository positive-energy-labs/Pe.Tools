using Newtonsoft.Json.Linq;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Profiles;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class FamilyFoundryBulkMigrationHarnessTests {
    private const string ProfileFixtureName = "real-mech-equip-base-mapping.json";
    private const string LocalParameterName = "FF Migrator Harness Local Text";

    private static readonly string[] RequiredFamilyArtifacts = [
        "input-profile.json",
        "profile-summary.json",
        "operation-plan.json",
        "desired-migration-plan.json",
        "family-report.json",
        "snapshot-post.json",
        "snapshot-parameters-post.json",
        "snapshot-diff.json",
        "snapshot-parameters-diff.json",
        "snapshot-profile-dense-post.json",
        "snapshot-profile-empty-allowed-post.json",
        "parameter-events.json",
        "logs-detailed.json"
    ];

    private static readonly string[][] MechanicalEquipmentFamilyPartitions = [
        [
            "AprilAire 800 801 Series Humidifier",
            "Aprilaire - Dehumidifier - e Series - End Discharge",
            "Aprilaire - Dehumidifier - e Series - Top Discharge",
            "Aprilaire 2000 Series MERV16 Filter Chassis",
            "Broan_B1X0E65RS_ERV",
            "Broan_B1X0E65RT_ERV",
            "Broan_B1X0H65RT_HRV"
        ],
        [
            "Broan_B210E75RT_ERV",
            "Broan_ERVH100",
            "Broan_ERVS100",
            "Broan_HE Series ERV HRV",
            "Broan_L400L Fan",
            "Clearance_ME",
            "Fantech - Duct Silencer_LD Series"
        ],
        [
            "Fantech - FGR HV Filter Chassis",
            "Fantech - MUAH Heater",
            "Fantech - prioAir 10 EC Inline Fan BETA",
            "Fantech - prioAir 6 EC Inline Fan",
            "Fantech - prioAir 8 EC Inline Fan",
            "Magna3 - Mechanical Equipment",
            "Mitsubishi - Filter Box - FBHO2_Series"
        ],
        [
            "Mitsubishi - Filter Box - FBM_FBL_FBH_Series",
            "Mitsubishi Branch Box - 3 Branch",
            "Mitsubishi Branch Box - 5 Branch",
            "Mitsubishi Electrical Heat Kit",
            "Mitsubishi_MFZ_KJ",
            "Mitsubishi_MSZ-EF",
            "Mitsubishi_MSZ-GL"
        ],
        [
            "Mitsubishi_MUFZ-KJ",
            "Mitsubishi_MXZ-C",
            "Mitsubishi_MXZ-C H2i",
            "Mitsubishi_MXZ-SM36NAM-U1",
            "Mitsubishi_MXZ-SM36NAMHZ-U1",
            "Mitsubishi_MXZ-SM42NAMHZ-U1",
            "Mitsubishi_MXZ-SM48NAM-U1"
        ],
        [
            "Mitsubishi_MXZ-SM48NAMHZ-U1",
            "Mitsubishi_MXZ-SM60NAM-U1",
            "Mitsubishi_PEAD_A",
            "Mitsubishi_PEFY-NMAU-E4",
            "Mitsubishi_PFFY-NRMU",
            "Mitsubishi_PKA-HA",
            "Mitsubishi_PKA-KA"
        ],
        [
            "Mitsubishi_PKFY-NKMU",
            "Mitsubishi_PLA-BA",
            "Mitsubishi_PUMY-NKMU",
            "Mitsubishi_PUY-A-NKA7",
            "Mitsubishi_PUZ-A-NHA7",
            "Mitsubishi_PUZ-A-NKA7",
            "Mitsubishi_PUZ-HA"
        ],
        [
            "Mitsubishi_PVA-AA7",
            "Mitsubishi_PVFY-NAMU-E1",
            "Mitsubishi_SEZ-KDR1",
            "Mitsubishi_SLZ-KA",
            "Mitsubishi_SUZ-KA09NAHZ",
            "Mitsubishi_SUZ-KA12NAHZ",
            "Mitsubishi_SUZ-KA15NAHZ"
        ],
        [
            "Mitsubishi_SUZ-KA18NAHZ",
            "Mitsubishi_SUZ-KA24NAHZ",
            "Mitsubishi_SUZ-KA30NAHZ",
            "Mitsubishi_SUZ-KA36NAHZ",
            "Mitsubishi_SUZ_KA09-15_Series",
            "Mitsubishi_SUZ_KA18-36_Series",
            "Mitsubishi_SVZ-KP"
        ],
        [
            "Panasonic - Intelli-Balance - FV-10VE2 - Ventilation ERV",
            "Panasonic - WhisperComfort - FV-04VE1 - Ventilation ERV",
            "Panasonic - WhisperGreen Select - FV-0511VK2 - Exhaust Fan",
            "Panasonic - WhisperGreen Select - FV-0511VKSL2 - Exhaust Fan Light",
            "Panasonic - WhisperLine - Remote Mount In-Line Fan - Exhaust Fan",
            "Panasonic - WhisperRecessed LED Designer Fan - FV-08VRE2 - Exhaust Fan Light",
            "Panasonic - WhisperValue DC - FV-0510VS1 - Exhaust Fan"
        ],
        [
            "Radiator - Hydronic Fin Tube",
            "Santa Fe - Ultra155 Dehumidifier",
            "Santa Fe - Ultra205 Dehumidifier",
            "Santa Fe - Ultra70 - Dehumidifier",
            "Santa Fe - Ultra70 - TOP CONNECTION Dehumidifier",
            "Santa Fe - Ultra98 - TOP CONNECTION Dehumidifier",
            "Santa Fe - Ultra98 Dehumidifier"
        ],
        [
            "SpacePak_CC32",
            "Tamarack Technologies Dragon Garage Fan",
            "Thunderbird Dryer Vent",
            "VMB_Rev.A_v1.0"
        ]
    ];

    private static IEnumerable<TestCaseData> MechanicalEquipmentPartitionCases => MechanicalEquipmentFamilyPartitions
        .Select((familyNames, index) => new TestCaseData(index + 1, familyNames)
            .SetName($"Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_{index + 1:00}")
            .SetCategory($"MechanicalEquipmentPartition{index + 1:00}"));

    private Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) =>
        this._dbApplication = uiApplication?.Application
                              ?? throw new InvalidOperationException(
                                  "ricaun.RevitTest did not provide a UIApplication.");

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_sample() {
        var run = this.CreateBulkMigrationRun(
            nameof(this.Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_sample));

        try {
            AppendHarnessLog(run.HarnessLogPath, "selecting-fast-sample-families");
            var selectedFamilyNames = SelectMechanicalEquipmentFamilyNames(run.ProjectDocument, 2);
            AppendHarnessLog(run.HarnessLogPath, $"selected-fast-sample-families={string.Join(" | ", selectedFamilyNames)}");

            AppendHarnessLog(run.HarnessLogPath, "loading-real-profile");
            var profile = LoadAndAssertRealMechanicalEquipmentProfile();
            AppendHarnessLog(run.HarnessLogPath, "applying-real-profile");
            var result = ApplyMigrationProfile(
                run,
                profile,
                selectedFamilyNames,
                "real-mech-equipment-base-mapping-end-state");

            AppendHarnessLog(run.HarnessLogPath, "asserting-fast-run-summary");
            AssertBulkRunSucceeded(run, result, selectedFamilyNames);

            AppendHarnessLog(run.HarnessLogPath, "locating-fast-family-artifacts");
            foreach (var artifacts in LocateFamilyArtifacts(run.OutputDirectory, selectedFamilyNames)) {
                AppendHarnessLog(run.HarnessLogPath, $"asserting-fast-family-end-state family={artifacts.FamilyName}");
                AssertBulkFamilyEndState(artifacts);
            }
            AppendHarnessLog(run.HarnessLogPath, "fast-smoke-proof-complete");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(run.ProjectDocument);
        }
    }

    [Test]
    [Explicit("Final all-Mechanical-Equipment scale proof. Do not run while pe-dev timeout enforcement is under diagnosis; prefer one focused wrapper first.")]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_all_mechanical_equipment_families() {
        var run = this.CreateBulkMigrationRun(
            nameof(this.Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_all_mechanical_equipment_families));

        try {
            var selectedFamilyNames = SelectMechanicalEquipmentFamilies(run.ProjectDocument)
                .Select(family => family.Name)
                .ToList();
            Assert.That(selectedFamilyNames, Has.Count.EqualTo(81));
            RunMechanicalEquipmentFamilySubset(run, selectedFamilyNames.ToArray(), "real-mech-equipment-base-mapping-all-families", false);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(run.ProjectDocument);
        }
    }

    [TestCaseSource(nameof(MechanicalEquipmentPartitionCases))]
    [Explicit("Expensive all-Mechanical-Equipment scale proof. Prefer the concrete partition wrapper tests for one partition at a time.")]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition(
        int partitionNumber,
        string[] selectedFamilyNames
    ) => this.RunMechanicalEquipmentPartition(partitionNumber, selectedFamilyNames);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_01() =>
        this.RunMechanicalEquipmentPartition(1, MechanicalEquipmentFamilyPartitions[0]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_02() =>
        this.RunMechanicalEquipmentPartition(2, MechanicalEquipmentFamilyPartitions[1]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_03() =>
        this.RunMechanicalEquipmentPartition(3, MechanicalEquipmentFamilyPartitions[2]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_04() =>
        this.RunMechanicalEquipmentPartition(4, MechanicalEquipmentFamilyPartitions[3]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_05() =>
        this.RunMechanicalEquipmentPartition(5, MechanicalEquipmentFamilyPartitions[4]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_06() =>
        this.RunMechanicalEquipmentPartition(6, MechanicalEquipmentFamilyPartitions[5]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_07() =>
        this.RunMechanicalEquipmentPartition(7, MechanicalEquipmentFamilyPartitions[6]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_08() =>
        this.RunMechanicalEquipmentPartition(8, MechanicalEquipmentFamilyPartitions[7]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_09() =>
        this.RunMechanicalEquipmentPartition(9, MechanicalEquipmentFamilyPartitions[8]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_10() =>
        this.RunMechanicalEquipmentPartition(10, MechanicalEquipmentFamilyPartitions[9]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_panasonic_whispergreen_select_fv0511vk2() =>
        this.RunMechanicalEquipmentFamilySubset(
            nameof(this.Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_panasonic_whispergreen_select_fv0511vk2),
            ["Panasonic - WhisperGreen Select - FV-0511VK2 - Exhaust Fan"]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_11() =>
        this.RunMechanicalEquipmentPartition(11, MechanicalEquipmentFamilyPartitions[10]);

    [Test]
    public void Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition_12() =>
        this.RunMechanicalEquipmentPartition(12, MechanicalEquipmentFamilyPartitions[11]);

    private void RunMechanicalEquipmentPartition(int partitionNumber, string[] selectedFamilyNames) {
        var run = this.CreateBulkMigrationRun($"{nameof(this.Ff_migrator_bulk_project_profile_reaches_parameter_end_state_for_mechanical_equipment_partition)}_{partitionNumber:00}");

        try {
            AssertMechanicalEquipmentPartitionStillMatchesProject(run.ProjectDocument, partitionNumber, selectedFamilyNames);
            RunMechanicalEquipmentFamilySubset(run, selectedFamilyNames, $"real-mech-equipment-base-mapping-partition-{partitionNumber:00}", false);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(run.ProjectDocument);
        }
    }

    private void RunMechanicalEquipmentFamilySubset(string testName, string[] selectedFamilyNames) {
        var run = this.CreateBulkMigrationRun(testName);

        try {
            RunMechanicalEquipmentFamilySubset(run, selectedFamilyNames, testName, true);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(run.ProjectDocument);
        }
    }

    private static void RunMechanicalEquipmentFamilySubset(
        BulkMigrationHarnessRun run,
        string[] selectedFamilyNames,
        string scenarioName,
        bool assertExactFamilyNames
    ) {
        var profile = LoadAndAssertRealMechanicalEquipmentProfile();
        var result = ApplyMigrationProfile(
            run,
            profile,
            selectedFamilyNames,
            scenarioName);

        AssertBulkRunSucceeded(run, result, selectedFamilyNames, assertExactFamilyNames);

        foreach (var artifacts in LocateFamilyArtifacts(run.OutputDirectory, result.ProcessedFamilyNames))
            AssertBulkFamilyEndState(artifacts);
    }

    [Test]
    public void Ff_migrator_matrix_profile_proves_synthetic_value_and_metadata_state_for_mechanical_equipment_sample() {
        var run = this.CreateBulkMigrationRun(
            nameof(this.Ff_migrator_matrix_profile_proves_synthetic_value_and_metadata_state_for_mechanical_equipment_sample));

        try {
            AppendHarnessLog(run.HarnessLogPath, "selecting-matrix-real-sample-family");
            var realFamilyNames = SelectMechanicalEquipmentFamilyNames(run.ProjectDocument, 1);
            AppendHarnessLog(run.HarnessLogPath, $"selected-matrix-real-sample-family={string.Join(" | ", realFamilyNames)}");
            AppendHarnessLog(run.HarnessLogPath, "building-loading-setvalue-matrix-family");
            var setValueFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadSetValueMatrixFamily(
                this._dbApplication,
                run.ProjectDocument,
                run.OutputDirectory);
            AppendHarnessLog(run.HarnessLogPath, "building-loading-metadata-matrix-family");
            var metadataFamily = FamilyFoundryMatrixFixtureBuilder.BuildAndLoadMetadataStateFamily(
                this._dbApplication,
                run.ProjectDocument,
                run.OutputDirectory);
            var selectedFamilyNames = realFamilyNames
                .Concat([setValueFamily.Name, metadataFamily.Name])
                .ToList();

            AppendHarnessLog(run.HarnessLogPath, "building-narrow-matrix-profile");
            var profile = BuildNarrowMatrixMigrationProfile();
            AppendHarnessLog(run.HarnessLogPath, "applying-narrow-matrix-profile");
            var result = ApplyMigrationProfile(
                run,
                profile,
                selectedFamilyNames,
                "matrix-mech-equipment-value-and-metadata-proof");

            AssertBulkRunSucceeded(run, result, selectedFamilyNames);

            var artifactsByFamily = LocateFamilyArtifacts(run.OutputDirectory, selectedFamilyNames)
                .ToDictionary(artifacts => artifacts.FamilyName, StringComparer.Ordinal);
            AssertRealSampleSubsetEndState(artifactsByFamily[realFamilyNames.Single()]);
            AssertSetValueMatrixEndState(artifactsByFamily[FamilyFoundryMatrixFixtureBuilder.SetValueMatrixFamilyName]);
            AssertMetadataMatrixEndState(artifactsByFamily[FamilyFoundryMatrixFixtureBuilder.MetadataStateFamilyName]);
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(run.ProjectDocument);
        }
    }

    private BulkMigrationHarnessRun CreateBulkMigrationRun(string testName) {
        var outputDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(testName);
        var harnessLogPath = CreateHarnessLogPath(testName, outputDirectory);
        AppendHarnessLog(harnessLogPath, $"output-directory={outputDirectory}");
        var projectCopyPath = CopyProjectFixtureToOutput("Old_Template.rvt", outputDirectory);
        AppendHarnessLog(harnessLogPath, $"project-copy={projectCopyPath}");
        AppendHarnessLog(harnessLogPath, "opening-project");
        var projectDocument = this._dbApplication.OpenDocumentFile(projectCopyPath)
                              ?? throw new InvalidOperationException(
                                  $"Failed to open project fixture copy '{projectCopyPath}'.");
        AppendHarnessLog(harnessLogPath, $"opened-project title={projectDocument.Title}");

        return new BulkMigrationHarnessRun(outputDirectory, projectCopyPath, projectDocument, harnessLogPath);
    }

    private static string CreateHarnessLogPath(string testName, string outputDirectory) {
        var safeTestName = string.Concat(testName.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        var repoRoot = FindRepoRoot();
        var logDirectory = repoRoot is null
            ? outputDirectory
            : Path.Combine(repoRoot, ".artifacts", "logs", "family-foundry-harness");
        Directory.CreateDirectory(logDirectory);
        var logPath = Path.Combine(logDirectory, $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{safeTestName}.log");
        File.WriteAllText(Path.Combine(outputDirectory, "harness-log-path.txt"), logPath);
        return logPath;
    }

    private static string? FindRepoRoot() {
        var assemblyDirectory = Path.GetDirectoryName(typeof(FamilyFoundryBulkMigrationHarnessTests).Assembly.Location);
        foreach (var candidateRoot in new[] { assemblyDirectory, Directory.GetCurrentDirectory() }) {
            if (string.IsNullOrWhiteSpace(candidateRoot))
                continue;

            var directory = new DirectoryInfo(candidateRoot);
            while (directory != null) {
                if (File.Exists(Path.Combine(directory.FullName, "Pe.Tools.slnx")))
                    return directory.FullName;
                directory = directory.Parent;
            }
        }

        return null;
    }

    private static void AppendHarnessLog(string logPath, string message) {
        Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
        File.AppendAllText(logPath, $"{DateTime.UtcNow:O} {message}{Environment.NewLine}");
    }

    private static string CopyProjectFixtureToOutput(string fixtureFileName, string outputDirectory) {
        var fixturePath = RevitFamilyFixtureHarness.GetProjectFixturePath(fixtureFileName);
        var projectCopyPath = Path.Combine(outputDirectory, fixtureFileName);
        File.Copy(fixturePath, projectCopyPath, true);
        return projectCopyPath;
    }

    private static List<string> SelectMechanicalEquipmentFamilyNames(Document projectDocument, int count) {
        var selected = SelectMechanicalEquipmentFamilies(projectDocument)
            .Take(count)
            .Select(family => family.Name)
            .ToList();

        Assert.That(selected, Has.Count.EqualTo(count));
        return selected;
    }

    private static List<Family> SelectMechanicalEquipmentFamilies(Document projectDocument) =>
        new FilteredElementCollector(projectDocument)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => family.FamilyCategory?.BuiltInCategory == BuiltInCategory.OST_MechanicalEquipment)
            .OrderBy(family => family.Name, StringComparer.Ordinal)
            .ToList();

    private static void AssertMechanicalEquipmentPartitionStillMatchesProject(
        Document projectDocument,
        int partitionNumber,
        IReadOnlyCollection<string> selectedFamilyNames
    ) {
        var livePartitions = SelectMechanicalEquipmentFamilies(projectDocument)
            .Select(family => family.Name)
            .Chunk(7)
            .ToList();

        Assert.Multiple(() => {
            Assert.That(livePartitions, Has.Count.EqualTo(MechanicalEquipmentFamilyPartitions.Length));
            Assert.That(livePartitions[partitionNumber - 1], Is.EqualTo(selectedFamilyNames));
        });
    }

    private static List<Family> SelectFamiliesByName(Document projectDocument, IReadOnlyCollection<string> familyNames) {
        var familyNameSet = familyNames.ToHashSet(StringComparer.Ordinal);
        var selected = new FilteredElementCollector(projectDocument)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(family => familyNameSet.Contains(family.Name))
            .OrderBy(family => family.Name, StringComparer.Ordinal)
            .ToList();

        Assert.That(selected.Select(family => family.Name), Is.EquivalentTo(familyNames));
        return selected;
    }

    private static FFMigratorProfile LoadAndAssertRealMechanicalEquipmentProfile() {
        var profile = RevitFamilyFixtureHarness.LoadMigratorProfileFixture(ProfileFixtureName);
        Assert.Multiple(() => {
            Assert.That(profile.MappingData, Has.Count.EqualTo(38));
            Assert.That(profile.SharedParameters, Has.One.Matches<DesiredSharedParameterDeclaration>(parameter =>
                parameter.Name == "PE_G___TagInstance" && parameter.Value == "P-#"));
            Assert.That(profile.FamilyParameters, Has.One.Matches<DesiredFamilyParameterDeclaration>(parameter =>
                parameter.Name == LocalParameterName && parameter.Value == "local-ok"));
            Assert.That(profile.CleanFamilyDocument.Enabled, Is.True);
            Assert.That(profile.CleanFamilyDocument.EnablePurgeParams, Is.True);
        });

        return profile;
    }

    private static FFMigratorProfile BuildNarrowMatrixMigrationProfile() {
        var realProfile = LoadAndAssertRealMechanicalEquipmentProfile();
        var realMappingTargets = new HashSet<string>(StringComparer.Ordinal) {
            "PE_G___Model",
            "PE_E___Voltage",
            "PE_G___Weight",
            "PE_G_Dim_Width1"
        };

        return new FFMigratorProfile {
            ExecutionOptions = realProfile.ExecutionOptions,
            FilterFamilies = new BaseProfile.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeCategoriesEqualing = [BuiltInCategory.OST_MechanicalEquipment]
            },
            SharedParameterSelection = new SharedParameterSelectionSpec(),
            MappingData = realProfile.MappingData
                .Where(mapping => realMappingTargets.Contains(mapping.NewName))
                .Select(mapping => CloneMapping(mapping, onlyAddIfSourceExists: true))
                .Concat(BuildMatrixMappings())
                .ToList(),
            SharedParameters = realProfile.SharedParameters
                .Concat(BuildRealSubsetSharedDeclarations())
                .Concat(BuildMatrixSharedDeclarations())
                .ToList(),
            FamilyParameters = realProfile.FamilyParameters
                .Concat(BuildMatrixFamilyDeclarations())
                .ToList(),
            PerTypeAssignmentsTable = [BuildMatrixPerTypeTextRow()],
            CleanFamilyDocument = BuildMatrixCleanFamilyDocumentSettings(realProfile.CleanFamilyDocument),
            DeleteParams = realProfile.DeleteParams,
            SortParams = realProfile.SortParams
        };
    }

    private static CleanFamilyDocumentSettings BuildMatrixCleanFamilyDocumentSettings(CleanFamilyDocumentSettings source) => new() {
        Enabled = source.Enabled,
        EnablePurgeNestedFamilies = source.EnablePurgeNestedFamilies,
        EnablePurgeReferencePlanes = source.EnablePurgeReferencePlanes,
        EnablePurgeModelLines = source.EnablePurgeModelLines,
        EnablePurgeParams = source.EnablePurgeParams,
        PurgeParamsSettings = new PurgeParamsBase {
            DirectDeleteEmptyParameters = source.PurgeParamsSettings.DirectDeleteEmptyParameters,
            ConsiderZeroValueAsEmpty = source.PurgeParamsSettings.ConsiderZeroValueAsEmpty,
            ConsiderEmptyStringAsEmpty = source.PurgeParamsSettings.ConsiderEmptyStringAsEmpty,
            ExcludeNames = new ExcludeSharedParameter {
                Equaling = source.PurgeParamsSettings.ExcludeNames.Equaling
                    .Concat(MatrixMetadataParameterNames())
                    .Distinct(StringComparer.Ordinal)
                    .ToList(),
                Containing = source.PurgeParamsSettings.ExcludeNames.Containing.ToList(),
                StartingWith = source.PurgeParamsSettings.ExcludeNames.StartingWith.ToList()
            }
        }
    };

    private static IEnumerable<string> MatrixMetadataParameterNames() => [
        FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText,
        FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber,
        FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip,
        FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText,
        FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength,
        FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared,
        FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText
    ];

    private static MappingData CloneMapping(MappingData mapping, bool onlyAddIfSourceExists) => new() {
        NewName = mapping.NewName,
        CurrNames = mapping.CurrNames.ToList(),
        OnlyAddIfSourceExists = onlyAddIfSourceExists,
        MappingStrategy = mapping.MappingStrategy
    };

    private static IEnumerable<DesiredSharedParameterDeclaration> BuildRealSubsetSharedDeclarations() {
        yield return SharedDeclaration("PE_G___Model", SpecTypeId.String.Text, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration("PE_E___Voltage", SpecTypeId.ElectricalPotential, GroupTypeId.Electrical, false,
            mappingStrategy: "CoerceElectrical");
        yield return SharedDeclaration("PE_G___Weight", SpecTypeId.Number, GroupTypeId.IdentityData, false,
            mappingStrategy: nameof(BuiltInCoercionStrategy.CoerceMeasurableToNumber));
        yield return SharedDeclaration("PE_G_Dim_Width1", SpecTypeId.Length, GroupTypeId.Geometry, false);
    }

    private static IEnumerable<MappingData> BuildMatrixMappings() {
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetText,
            [FamilyFoundryMatrixFixtureBuilder.SourceText]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber,
            [FamilyFoundryMatrixFixtureBuilder.SourceBlankText, FamilyFoundryMatrixFixtureBuilder.SourceFallbackText]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetInteger,
            [FamilyFoundryMatrixFixtureBuilder.SourceInteger]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetYesNo,
            [FamilyFoundryMatrixFixtureBuilder.SourceYesNo]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetNumber,
            [FamilyFoundryMatrixFixtureBuilder.SourceNumberText]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetLength,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetVoltage,
            [FamilyFoundryMatrixFixtureBuilder.SourceVoltageText], "CoerceElectrical");
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetCurrent,
            [FamilyFoundryMatrixFixtureBuilder.SourceCurrentText], "CoerceElectrical");
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength,
            [FamilyFoundryMatrixFixtureBuilder.SourceFormulaNested]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength,
            [FamilyFoundryMatrixFixtureBuilder.SourceLengthText]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension,
            [FamilyFoundryMatrixFixtureBuilder.SourceLinearDimension]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension,
            [FamilyFoundryMatrixFixtureBuilder.SourceAngularDimension]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension,
            [FamilyFoundryMatrixFixtureBuilder.SourceRadialDimension]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount,
            [FamilyFoundryMatrixFixtureBuilder.SourceArrayCount]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth,
            [FamilyFoundryMatrixFixtureBuilder.SourceNestedWidth]);
        yield return Mapping(FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber,
            [FamilyFoundryMatrixFixtureBuilder.SourceText]);
    }

    private static IEnumerable<DesiredSharedParameterDeclaration> BuildMatrixSharedDeclarations() {
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber, SpecTypeId.Number, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetInteger, SpecTypeId.Int.Integer, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetYesNo, SpecTypeId.Boolean.YesNo, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetNumber, SpecTypeId.Number, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetLength, SpecTypeId.Length, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetVoltage, SpecTypeId.ElectricalPotential, GroupTypeId.Electrical, false,
            mappingStrategy: "CoerceElectrical");
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetCurrent, SpecTypeId.Current, GroupTypeId.Electrical, false,
            mappingStrategy: "CoerceElectrical");
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength, SpecTypeId.Length, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength, SpecTypeId.Length, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension, SpecTypeId.Length, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension, SpecTypeId.Angle, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension, SpecTypeId.Length, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetArrayCount, SpecTypeId.Int.Integer, GroupTypeId.Geometry, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth, SpecTypeId.Length, GroupTypeId.Geometry, true);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber, SpecTypeId.Number, GroupTypeId.IdentityData, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetGlobalText, SpecTypeId.String.Text, GroupTypeId.Text, false,
            value: "matrix-global-ok");
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        yield return SharedDeclaration(FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength, SpecTypeId.Length, GroupTypeId.Geometry, true);
    }

    private static IEnumerable<DesiredFamilyParameterDeclaration> BuildMatrixFamilyDeclarations() {
        yield return FamilyDeclaration(FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        yield return FamilyDeclaration(FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText, SpecTypeId.String.Text, GroupTypeId.Text, false);
        yield return FamilyDeclaration(FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber, SpecTypeId.Number, GroupTypeId.IdentityData, true);
        yield return FamilyDeclaration(FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip, SpecTypeId.String.Text, GroupTypeId.IdentityData, false,
            tooltip: FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltipDescription);
        yield return FamilyDeclaration(
            FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText,
            SpecTypeId.String.Text,
            GroupTypeId.IdentityData,
            false,
            tooltip: "Metadata state applied by the matrix migration profile.",
            value: "metadata-applied-local-ok");
    }

    private static DesiredFamilyParameterDeclaration FamilyDeclaration(
        string name,
        ForgeTypeId dataType,
        ForgeTypeId propertiesGroup,
        bool isInstance,
        string? tooltip = null,
        string? value = null
    ) => new() {
        Name = name,
        DataType = dataType,
        PropertiesGroup = propertiesGroup,
        IsInstance = isInstance,
        Tooltip = tooltip,
        Value = value
    };

    private static DesiredPerTypeAssignmentRow BuildMatrixPerTypeTextRow() => new() {
        Parameter = FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText,
        ValuesByType = new Dictionary<string, JToken>(StringComparer.Ordinal) {
            [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[0]] = JToken.FromObject("per-type-a"),
            [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[1]] = JToken.FromObject("per-type-b"),
            [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[2]] = JToken.FromObject("per-type-c")
        }
    };

    private static DesiredSharedParameterDeclaration SharedDeclaration(
        string name,
        ForgeTypeId dataType,
        ForgeTypeId propertiesGroup,
        bool isInstance,
        string? mappingStrategy = null,
        string? value = null
    ) => new() {
        Name = name,
        DataType = dataType,
        PropertiesGroup = propertiesGroup,
        IsInstance = isInstance,
        MappingStrategy = mappingStrategy ?? nameof(BuiltInCoercionStrategy.CoerceByStorageType),
        Value = value
    };

    private static MappingData Mapping(
        string target,
        IEnumerable<string> sources,
        string mappingStrategy = nameof(BuiltInCoercionStrategy.CoerceByStorageType)
    ) => new() {
        NewName = target,
        CurrNames = sources.ToList(),
        OnlyAddIfSourceExists = true,
        MappingStrategy = mappingStrategy
    };

    private static FamilyMigrationApplyResult ApplyMigrationProfile(
        BulkMigrationHarnessRun run,
        FFMigratorProfile profile,
        IReadOnlyCollection<string> selectedFamilyNames,
        string profileName
    ) {
        var selectedFamilies = SelectFamiliesByName(run.ProjectDocument, selectedFamilyNames);
        return run.ProjectDocument.ApplyFamilyMigrationProfile(
            profile,
            profileName,
            selectedFamilies,
            new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = true,
                SaveFamilyToInternalPath = false,
                SaveFamilyToOutputDir = true
            },
            OutputStorage.ExactDir(run.OutputDirectory));
    }

    private static void AssertBulkRunSucceeded(
        BulkMigrationHarnessRun run,
        FamilyMigrationApplyResult result,
        IReadOnlyCollection<string> expectedFamilyNames,
        bool assertExactFamilyNames = true
    ) {
        Assert.That(result.Success, Is.True, result.Error);
        Assert.That(result.FamilyCount, Is.EqualTo(expectedFamilyNames.Count));
        Assert.That(result.ProcessedFamilyNames, Has.Count.EqualTo(expectedFamilyNames.Count));
        if (assertExactFamilyNames)
            Assert.That(result.ProcessedFamilyNames, Is.EquivalentTo(expectedFamilyNames));
        Assert.That(result.OutputFolderPath, Is.EqualTo(run.OutputDirectory));

        var runSummaryPath = Path.Combine(run.OutputDirectory, "run-summary.json");
        Assert.That(File.Exists(runSummaryPath), Is.True, runSummaryPath);

        var runSummary = JObject.Parse(File.ReadAllText(runSummaryPath));
        Assert.Multiple(() => {
            Assert.That((int?)runSummary["Summary"]?["TotalFamilies"], Is.EqualTo(expectedFamilyNames.Count));
            Assert.That((int?)runSummary["Summary"]?["Failed"], Is.EqualTo(0));
            Assert.That((int?)runSummary["Summary"]?["TotalErrors"], Is.EqualTo(0));
            Assert.That(runSummary["Families"]?.Count(), Is.EqualTo(expectedFamilyNames.Count));
            if (assertExactFamilyNames)
                Assert.That(
                    runSummary["Families"]?.Select(family => (string?)family["Family"]),
                    Is.EquivalentTo(expectedFamilyNames));
        });
    }

    private static List<BulkFamilyArtifacts> LocateFamilyArtifacts(
        string outputDirectory,
        IReadOnlyCollection<string> familyNames
    ) {
        var runSummaryPath = Path.Combine(outputDirectory, "run-summary.json");
        var runSummary = JObject.Parse(File.ReadAllText(runSummaryPath));

        return familyNames
            .Select(familyName => LocateFamilyArtifacts(outputDirectory, runSummary, familyName))
            .ToList();
    }

    private static BulkFamilyArtifacts LocateFamilyArtifacts(
        string outputDirectory,
        JObject runSummary,
        string familyName
    ) {
        var familySummary = runSummary["Families"]?
            .FirstOrDefault(family => string.Equals((string?)family["Family"], familyName, StringComparison.Ordinal));
        Assert.That(familySummary, Is.Not.Null, $"Missing run-summary family entry for '{familyName}'.");

        var familyDirectoryName = (string?)familySummary!["Artifacts"]?["FamilyDirectory"] ?? familyName;
        var familyDirectory = Path.Combine(outputDirectory, familyDirectoryName);
        Assert.That(Directory.Exists(familyDirectory), Is.True, familyDirectory);

        foreach (var artifact in RequiredFamilyArtifacts)
            Assert.That(File.Exists(Path.Combine(familyDirectory, artifact)), Is.True,
                $"Missing {artifact} for {familyName}");

        return new BulkFamilyArtifacts(
            familyName,
            familyDirectory,
            LoadJson(familyDirectory, "family-report.json"),
            LoadJson(familyDirectory, "desired-migration-plan.json"),
            LoadJson(familyDirectory, "snapshot-diff.json"),
            LoadJson(familyDirectory, "snapshot-parameters-diff.json"),
            LoadJson(familyDirectory, "snapshot-parameters-post.json"),
            LoadJson(familyDirectory, "snapshot-post.json"),
            LoadJson(familyDirectory, "parameter-events.json"));
    }

    private static JObject LoadJson(string directory, string fileName) =>
        JObject.Parse(File.ReadAllText(Path.Combine(directory, fileName)));

    private static void AssertBulkFamilyEndState(BulkFamilyArtifacts artifacts) {
        Assert.Multiple(() => {
            Assert.That((string?)artifacts.FamilyReport["Family"], Is.EqualTo(artifacts.FamilyName));
            Assert.That(artifacts.FamilyReport["Error"]?.Type, Is.Null.Or.EqualTo(JTokenType.Null));
            Assert.That(artifacts.FamilyReport["Artifacts"]?["SnapshotDiffPath"]?.Type, Is.EqualTo(JTokenType.String));
            Assert.That((string?)artifacts.SnapshotDiff["Family"], Is.EqualTo(artifacts.FamilyName));
            Assert.That((int?)artifacts.ParameterDiff["Summary"]?["ParametersAdded"], Is.GreaterThan(0));
            Assert.That(artifacts.DesiredMigrationPlan["Parameters"]!.Count(), Is.GreaterThanOrEqualTo(38));

            AssertParameterProjectedOrHasPostValue(artifacts, "PE_E___Voltage");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G___Weight");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G_Dim_Width1");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G___TagInstance", "P-#");
            AssertParameterProjectedOrHasPostValue(artifacts, LocalParameterName, "local-ok");
            AssertParameterEvent(
                artifacts,
                "PE_E___Voltage",
                ParameterEventOutcome.DirectReplaceSucceeded,
                ParameterEventOutcome.ValueMapped,
                ParameterEventOutcome.TargetAdded);
        });
    }

    private static void AssertRealSampleSubsetEndState(BulkFamilyArtifacts artifacts) {
        Assert.Multiple(() => {
            Assert.That((string?)artifacts.FamilyReport["Family"], Is.EqualTo(artifacts.FamilyName));
            Assert.That(artifacts.FamilyReport["Error"]?.Type, Is.Null.Or.EqualTo(JTokenType.Null));
            Assert.That((string?)artifacts.SnapshotDiff["Family"], Is.EqualTo(artifacts.FamilyName));
            Assert.That((int?)artifacts.ParameterDiff["Summary"]?["ParametersAdded"], Is.GreaterThan(0));
            Assert.That(artifacts.DesiredMigrationPlan["Parameters"]!.Count(), Is.GreaterThanOrEqualTo(20));

            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G___Model");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_E___Voltage");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G___Weight");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G_Dim_Width1");
            AssertParameterProjectedOrHasPostValue(artifacts, "PE_G___TagInstance", "P-#");
            AssertParameterProjectedOrHasPostValue(artifacts, LocalParameterName, "local-ok");
            AssertParameterEvent(artifacts, "PE_E___Voltage", ParameterEventOutcome.DirectReplaceSucceeded, ParameterEventOutcome.ValueMapped);
        });
    }

    private static void AssertSetValueMatrixEndState(BulkFamilyArtifacts artifacts) {
        Assert.Multiple(() => {
            Assert.That((string?)artifacts.FamilyReport["Family"], Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.SetValueMatrixFamilyName));
            Assert.That(artifacts.FamilyReport["Error"]?.Type, Is.Null.Or.EqualTo(JTokenType.Null));
            Assert.That((int?)artifacts.ParameterDiff["Summary"]?["ParametersAdded"], Is.GreaterThan(0));

            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetText, "matrix-text");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber, "22");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetInteger);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetYesNo);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetNumber, "-7.25");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetLength);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetVoltage, "120");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetCurrent, "18.5");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetArrayCount);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetGlobalText, "matrix-global-ok");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText, "per-type-a");

            AssertParameterHasNoFormula(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength);
            AssertParameterHasNoFormula(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber, StorageType.Double, SpecTypeId.Number, GroupTypeId.IdentityData, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetInteger, StorageType.Integer, SpecTypeId.Int.Integer, GroupTypeId.IdentityData, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetYesNo, StorageType.Integer, SpecTypeId.Boolean.YesNo, GroupTypeId.IdentityData, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetNumber, StorageType.Double, SpecTypeId.Number, GroupTypeId.IdentityData, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetLength, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetVoltage, StorageType.Double, SpecTypeId.ElectricalPotential, GroupTypeId.Electrical, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetCurrent, StorageType.Double, SpecTypeId.Current, GroupTypeId.Electrical, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetFormulaUnwrappedLength, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetAngularDimension, StorageType.Double, SpecTypeId.Angle, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetRadialDimension, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetArrayCount, StorageType.Integer, SpecTypeId.Int.Integer, GroupTypeId.Geometry, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, true, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetGlobalText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text, false, false);
            AssertParameterHasTypeValues(
                artifacts.SnapshotPost,
                FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText,
                new Dictionary<string, string>(StringComparer.Ordinal) {
                    [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[0]] = "per-type-a",
                    [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[1]] = "per-type-b",
                    [FamilyFoundryMatrixFixtureBuilder.MatrixTypeNames[2]] = "per-type-c"
                });

            AssertParameterEventsIncludeAll(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetBlankFallbackNumber, ParameterEventOutcome.EmptySourceValue, ParameterEventOutcome.ValueMapped);
            AssertParameterEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetVoltage, ParameterEventOutcome.ValueMapped);
            AssertParameterEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetExistingFormulaLength, ParameterEventOutcome.ValueMapped);
            AssertParameterEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetLinearDimension, ParameterEventOutcome.DirectReplaceSucceeded, ParameterEventOutcome.ValueMapped);
            AssertParameterEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetArrayCount, ParameterEventOutcome.DirectReplaceSucceeded, ParameterEventOutcome.ValueMapped);
            AssertParameterEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetNestedWidth, ParameterEventOutcome.DirectReplaceSucceeded, ParameterEventOutcome.ValueMapped);
            AssertParameterDiagnosticEventDetails(
                artifacts,
                FamilyFoundryMatrixFixtureBuilder.TargetInvalidNumber,
                ParameterEventOutcome.AllSourceCandidatesFailed,
                nameof(BuiltInCoercionStrategy.CoerceByStorageType));
            AssertParameterValueEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.TargetPerTypeText, ParameterEventOutcome.PerTypeValueSet);
        });
    }

    private static void AssertMetadataMatrixEndState(BulkFamilyArtifacts artifacts) {
        Assert.Multiple(() => {
            Assert.That((string?)artifacts.FamilyReport["Family"], Is.EqualTo(FamilyFoundryMatrixFixtureBuilder.MetadataStateFamilyName));
            Assert.That(artifacts.FamilyReport["Error"]?.Type, Is.Null.Or.EqualTo(JTokenType.Null));

            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataLocalTypeText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text, false, false);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataLocalInstanceNumber, StorageType.Double, SpecTypeId.Number, GroupTypeId.IdentityData, true, false);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip, StorageType.String, SpecTypeId.String.Text, GroupTypeId.IdentityData, true, false);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataSharedTypeText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Text, false, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataSharedInstanceLength, StorageType.Double, SpecTypeId.Length, GroupTypeId.Geometry, true, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared, StorageType.String, SpecTypeId.String.Text, GroupTypeId.Electrical, true, true);
            AssertParameterPostMetadata(artifacts.SnapshotPost, FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText, StorageType.String, SpecTypeId.String.Text, GroupTypeId.IdentityData, false, false);
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.MetadataLocalTooltip, "tooltip-backed-value");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.MetadataProjectBoundShared, "project-bound-family-value");
            AssertParameterProjectedOrHasPostValue(artifacts, FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText, "metadata-applied-local-ok");
            AssertParameterValueEvent(artifacts, FamilyFoundryMatrixFixtureBuilder.MetadataAppliedLocalText, ParameterEventOutcome.GlobalValueSet);
        });
    }

    private static bool IsSuccessfulMappingOutcome(string? outcome) =>
        outcome is "DirectReplaceSucceeded" or "ValueMapped";

    private static void AssertParameterPostMetadata(
        JObject snapshot,
        string parameterName,
        StorageType storageType,
        ForgeTypeId dataType,
        ForgeTypeId propertiesGroup,
        bool isInstance,
        bool isShared
    ) {
        var parameter = FindParameter(snapshot, parameterName);
        if (parameter == null) {
            Assert.Fail($"Expected parameter '{parameterName}' in post snapshot.");
            return;
        }

        var serialized = parameter.ToString();
        Assert.Multiple(() => {
            Assert.That(ReadStorageType(parameter), Is.EqualTo(storageType), parameterName);
            Assert.That((bool?)parameter["IsInstance"], Is.EqualTo(isInstance), parameterName);
            Assert.That(serialized, Does.Contain(dataType.TypeId), parameterName);
            Assert.That(serialized, Does.Contain(propertiesGroup.TypeId), parameterName);
            if (isShared)
                Assert.That(parameter["SharedGuid"]?.Type, Is.Not.Null.And.Not.EqualTo(JTokenType.Null), parameterName);
            else
                Assert.That(parameter["SharedGuid"]?.Type, Is.Null.Or.EqualTo(JTokenType.Null), parameterName);
        });
    }

    private static StorageType? ReadStorageType(JToken parameter) {
        var token = parameter["StorageType"];
        if (token == null || token.Type == JTokenType.Null)
            return null;
        if (token.Type == JTokenType.Integer)
            return (StorageType)(int)token;
        return Enum.TryParse<StorageType>((string?)token, out var storageType) ? storageType : null;
    }

    private static void AssertParameterHasTypeValues(
        JObject snapshot,
        string parameterName,
        IReadOnlyDictionary<string, string> expectedValuesByType
    ) {
        var parameter = FindParameter(snapshot, parameterName);
        Assert.That(parameter, Is.Not.Null, $"Expected parameter '{parameterName}' in post snapshot.");

        var valuesByType = parameter!["ValuesPerType"];
        Assert.That(valuesByType?.Type, Is.EqualTo(JTokenType.Object), parameterName);
        Assert.Multiple(() => {
            foreach (var expected in expectedValuesByType)
                Assert.That((string?)valuesByType![expected.Key], Does.Contain(expected.Value),
                    $"Expected '{parameterName}' type '{expected.Key}' to contain '{expected.Value}'.");
        });
    }

    private static void AssertParameterHasNoFormula(JObject snapshot, string parameterName) {
        var parameter = FindParameter(snapshot, parameterName);
        Assert.That(parameter, Is.Not.Null, $"Expected parameter '{parameterName}' in post snapshot.");
        Assert.That((string?)parameter!["Formula"], Is.Null.Or.Empty,
            $"Expected parameter '{parameterName}' formula to be unset.");
    }

    private static void AssertParameterEvent(
        BulkFamilyArtifacts artifacts,
        string mappingKey,
        params ParameterEventOutcome[] outcomes
    ) {
        var outcomeNames = outcomes.Select(outcome => outcome.ToString()).ToHashSet(StringComparer.Ordinal);
        var matches = artifacts.ParameterEvents["Events"]!
            .Where(parameterEvent => string.Equals((string?)parameterEvent["MappingKey"], mappingKey, StringComparison.Ordinal) &&
                                     outcomeNames.Contains((string?)parameterEvent["Outcome"] ?? string.Empty))
            .ToList();
        Assert.That(matches, Is.Not.Empty,
            $"Expected parameter-events.json to contain {string.Join("/", outcomeNames)} for mapping '{mappingKey}'.");
    }

    private static void AssertParameterEventsIncludeAll(
        BulkFamilyArtifacts artifacts,
        string mappingKey,
        params ParameterEventOutcome[] outcomes
    ) {
        foreach (var outcome in outcomes)
            AssertParameterEvent(artifacts, mappingKey, outcome);
    }

    private static void AssertParameterDiagnosticEventDetails(
        BulkFamilyArtifacts artifacts,
        string mappingKey,
        ParameterEventOutcome outcome,
        string expectedMappingStrategy
    ) {
        var match = artifacts.ParameterEvents["Events"]!
            .FirstOrDefault(parameterEvent =>
                string.Equals((string?)parameterEvent["MappingKey"], mappingKey, StringComparison.Ordinal) &&
                string.Equals((string?)parameterEvent["Outcome"], outcome.ToString(), StringComparison.Ordinal));
        Assert.That(match, Is.Not.Null,
            $"Expected parameter-events.json to contain {outcome} for mapping '{mappingKey}'.");

        var details = match!["Details"];
        Assert.Multiple(() => {
            Assert.That((string?)details?["MappingStrategy"], Is.EqualTo(expectedMappingStrategy), mappingKey);
            Assert.That((string?)details?["SourceStorageType"], Is.Not.Null.And.Not.Empty, mappingKey);
            Assert.That((string?)details?["TargetStorageType"], Is.Not.Null.And.Not.Empty, mappingKey);
            Assert.That((string?)details?["SourceDataType"], Is.Not.Null.And.Not.Empty, mappingKey);
            Assert.That((string?)details?["TargetDataType"], Is.Not.Null.And.Not.Empty, mappingKey);
            Assert.That((string?)details?["CanMap"], Is.EqualTo("False"), mappingKey);
        });
    }

    private static void AssertParameterValueEvent(
        BulkFamilyArtifacts artifacts,
        string parameterName,
        ParameterEventOutcome outcome
    ) {
        var matches = artifacts.ParameterEvents["Events"]!
            .Where(parameterEvent => string.Equals((string?)parameterEvent["ParameterName"], parameterName, StringComparison.Ordinal) &&
                                     string.Equals((string?)parameterEvent["Outcome"], outcome.ToString(), StringComparison.Ordinal))
            .ToList();
        Assert.That(matches, Is.Not.Empty,
            $"Expected parameter-events.json to contain {outcome} for parameter '{parameterName}'.");
    }

    private static void AssertParameterProjectedOrHasPostValue(
        BulkFamilyArtifacts artifacts,
        string parameterName,
        string? expectedValuePart = null
    ) {
        if (ProjectionHasAssignment(artifacts.SnapshotParameterProjection, parameterName, expectedValuePart)) {
            AssertParameterDiffMentions(artifacts.ParameterDiff, parameterName);
            return;
        }

        AssertParameterHasAnyValue(artifacts.SnapshotPost, parameterName, expectedValuePart);
    }

    private static bool ProjectionHasAssignment(
        JObject parameterProjection,
        string parameterName,
        string? expectedValuePart
    ) {
        var globalAssignment = parameterProjection["SetKnownParams"]?["GlobalAssignments"]?
            .FirstOrDefault(assignment =>
                string.Equals((string?)assignment["Parameter"], parameterName, StringComparison.Ordinal));
        if (globalAssignment != null)
            return string.IsNullOrWhiteSpace(expectedValuePart) ||
                   ((string?)globalAssignment["Value"])?.Contains(
                       expectedValuePart,
                       StringComparison.OrdinalIgnoreCase) == true;

        var perTypeRow = parameterProjection["SetKnownParams"]?["PerTypeAssignmentsTable"]?
            .FirstOrDefault(row => string.Equals((string?)row["Parameter"], parameterName, StringComparison.Ordinal));
        if (perTypeRow == null)
            return false;

        var values = perTypeRow.Children<JProperty>()
            .Where(property => !string.Equals(property.Name, "Parameter", StringComparison.Ordinal))
            .Select(property => (string?)property.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();

        return string.IsNullOrWhiteSpace(expectedValuePart)
            ? values.Count > 0
            : values.Any(value => value!.Contains(expectedValuePart, StringComparison.OrdinalIgnoreCase));
    }

    private static void AssertParameterDiffMentions(JObject parameterDiff, string parameterName) {
        var serializedDiff = parameterDiff.ToString();
        Assert.That(serializedDiff, Does.Contain(parameterName),
            $"Expected parameter diff to mention '{parameterName}'.");
    }

    private static void AssertParameterHasAnyValue(JObject snapshot, string parameterName, string? expectedValuePart = null) {
        var parameter = FindParameter(snapshot, parameterName);
        Assert.That(parameter, Is.Not.Null, $"Expected parameter '{parameterName}' in post snapshot.");
        var values = parameter!["ValuesPerType"]!
            .Children<JProperty>()
            .Select(property => (string?)property.Value)
            .Where(value => !string.IsNullOrWhiteSpace(value))
            .ToList();

        Assert.That(values, Is.Not.Empty, $"Expected parameter '{parameterName}' to have at least one value.");
        if (!string.IsNullOrWhiteSpace(expectedValuePart))
            Assert.That(values.Any(value => value!.Contains(expectedValuePart, StringComparison.OrdinalIgnoreCase)),
                Is.True,
                $"Expected parameter '{parameterName}' to have a value containing '{expectedValuePart}'. Values: {string.Join(", ", values)}");
    }

    private static JToken? FindParameter(JObject snapshot, string parameterName) =>
        snapshot["Parameters"]?["Data"]?
            .FirstOrDefault(parameter =>
                string.Equals((string?)parameter["Name"], parameterName, StringComparison.Ordinal));

    private sealed record BulkMigrationHarnessRun(
        string OutputDirectory,
        string ProjectCopyPath,
        Document ProjectDocument,
        string HarnessLogPath
    );

    private sealed record BulkFamilyArtifacts(
        string FamilyName,
        string FamilyDirectory,
        JObject FamilyReport,
        JObject DesiredMigrationPlan,
        JObject SnapshotDiff,
        JObject ParameterDiff,
        JObject SnapshotParameterProjection,
        JObject SnapshotPost,
        JObject ParameterEvents
    );
}
