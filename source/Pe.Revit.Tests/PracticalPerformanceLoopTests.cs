using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Revit.Tests;

[TestFixture]
[Category("Performance")]
[Explicit("Practical Revit performance loops. Runs repeated open/action/close benchmarks against generic staged documents.")]
public sealed class PracticalPerformanceLoopTests {
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string WineGuardianIndoorProfileFixture = "wineguardian-ds050-indoor.json";
    private const int DefaultIterations = 3;

    private Autodesk.Revit.ApplicationServices.Application _dbApplication = null!;

    [OneTimeSetUp]
    public void SetUp(UIApplication uiApplication) {
        _dbApplication = uiApplication?.Application
            ?? throw new InvalidOperationException("ricaun.RevitTest did not provide a UIApplication.");
    }

    [Test]
    public void FF_manager_roundtrip_can_repeat_on_staged_generic_family_document() {
        var profile = RevitFamilyFixtureHarness.LoadProfileFixture(WineGuardianIndoorProfileFixture);
        var seedFamilyPath = StageGenericFamilyDocument(nameof(FF_manager_roundtrip_can_repeat_on_staged_generic_family_document));
        var benchmarkRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            $"{nameof(FF_manager_roundtrip_can_repeat_on_staged_generic_family_document)}-runs");

        var summary = RevitBenchmarkHarness.RunDocumentLoop(
            _dbApplication,
            nameof(FF_manager_roundtrip_can_repeat_on_staged_generic_family_document),
            DefaultIterations,
            seedFamilyPath,
            (iteration, familyDocument) => {
                Assert.That(familyDocument.IsFamilyDocument, Is.True);

                var iterationOutputDirectory = Path.Combine(benchmarkRoot, $"iter-{iteration:00}");
                Directory.CreateDirectory(iterationOutputDirectory);

                var result = FamilyFoundryRoundtripHarness.ProcessRoundtrip(
                    familyDocument,
                    profile,
                    $"{WineGuardianIndoorProfileFixture}-iter-{iteration:00}",
                    iterationOutputDirectory);
                var savedFamilyPath = RevitFamilyFixtureHarness.GetExpectedSavedFamilyPath(
                    result.OutputFolderPath!,
                    familyDocument);

                RevitFamilyFixtureHarness.AssertSavedFamilyFileIsOpenable(_dbApplication, savedFamilyPath);
                Assert.That(result.Contexts[0].PostProcessSnapshot?.Parameters?.Data?.Count ?? 0, Is.GreaterThan(0));

                return new FamilyRoundtripBenchmarkResult(
                    result.TotalMs,
                    result.Contexts[0].PostProcessSnapshot?.Parameters?.Data?.Count ?? 0,
                    savedFamilyPath);
            });

        Assert.That(summary.Iterations, Has.Count.EqualTo(DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.PostProcessParameterCount > 0), Is.True);
    }

    [Test]
    public void Loaded_families_matrix_can_repeat_on_staged_project_document() {
        var stagedProjectPath = StageGenericProjectDocument(
            nameof(Loaded_families_matrix_can_repeat_on_staged_project_document));

        var summary = RevitBenchmarkHarness.RunDocumentLoop(
            _dbApplication,
            nameof(Loaded_families_matrix_can_repeat_on_staged_project_document),
            DefaultIterations,
            stagedProjectPath,
            (_, projectDocument) => {
                Assert.That(projectDocument.IsFamilyDocument, Is.False);
                var progressLines = new List<string>();

                var data = LoadedFamiliesMatrixCollector.Collect(projectDocument, null, progressLines.Add);
                var visibleParameterCount = data.Families.Sum(family => family.VisibleParameters.Count);

                Assert.That(data.Families, Is.Not.Empty);
                Assert.That(data.Families.Count, Is.GreaterThan(1));
                Assert.That(visibleParameterCount, Is.GreaterThan(0));

                return new LoadedFamiliesMatrixBenchmarkResult(data.Families.Count, visibleParameterCount, data.Issues.Count, progressLines);
            });

        Assert.That(summary.Iterations, Has.Count.EqualTo(DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.FamilyCount > 0), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.VisibleParameterCount > 0), Is.True);
    }

    [Test]
    public void FF_migrator_style_queue_can_repeat_on_staged_project_document() {
        var stagedProjectPath = StageGenericProjectDocument(
            nameof(FF_migrator_style_queue_can_repeat_on_staged_project_document));
        var profile = CreateBenchmarkMigratorProfile();
        var queue = CmdFFMigrator.BuildQueueCore(profile, []);
        var collectorQueue = new CollectorQueue()
            .Add(new ParamSectionCollector())
            .Add(new RefPlaneSectionCollector());
        var benchmarkRoot = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory(
            $"{nameof(FF_migrator_style_queue_can_repeat_on_staged_project_document)}-runs");

        var summary = RevitBenchmarkHarness.RunDocumentLoop(
            _dbApplication,
            nameof(FF_migrator_style_queue_can_repeat_on_staged_project_document),
            DefaultIterations,
            stagedProjectPath,
            (iteration, projectDocument) => {
                Assert.That(projectDocument.IsFamilyDocument, Is.False);

                var targetFamilies = new FilteredElementCollector(projectDocument)
                    .OfClass(typeof(Family))
                    .Cast<Family>()
                    .Where(family => !family.IsInPlace)
                    .Where(family => !string.IsNullOrWhiteSpace(family.Name))
                    .OrderBy(family => family.Name, StringComparer.Ordinal)
                    .Take(10)
                    .ToList();
                if (targetFamilies.Count == 0)
                    throw new InvalidOperationException("No loaded families were available for migrator benchmark.");
                var iterationOutputDirectory = Path.Combine(benchmarkRoot, $"iter-{iteration:00}");
                Directory.CreateDirectory(iterationOutputDirectory);

                using var processor = new OperationProcessor(projectDocument, profile.ExecutionOptions);
                var logs = processor
                    .SelectFamilies(() => targetFamilies)
                    .ProcessQueue(
                        queue,
                        collectorQueue,
                        iterationOutputDirectory,
                        new LoadAndSaveOptions {
                            OpenOutputFilesOnCommandFinish = false,
                            LoadFamily = false,
                            SaveFamilyToInternalPath = false,
                            SaveFamilyToOutputDir = true
                        });

                Assert.That(logs.contexts, Has.Count.EqualTo(targetFamilies.Count));
                foreach (var context in logs.contexts) {
                    var error = context.OperationLogs.AsTuple().error;
                    Assert.That(error, Is.Null, error?.ToString());
                }

                var outputFiles = Directory.GetFiles(iterationOutputDirectory, "*.rfa", SearchOption.AllDirectories);
                Assert.That(outputFiles, Is.Not.Empty);
                RevitFamilyFixtureHarness.AssertSavedFamilyFileIsOpenable(_dbApplication, outputFiles[0]);

                return new MigratorStyleBenchmarkResult(
                    logs.totalMs,
                    logs.contexts.Count,
                    outputFiles.Length,
                    targetFamilies.Select(family => family.Name).ToList());
            });

        Assert.That(summary.Iterations, Has.Count.EqualTo(DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.ContextCount > 0), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.OutputFamilyCount > 0), Is.True);
    }

    [Test]
    public void Parameter_assignment_paths_can_repeat_on_staged_family_document() {
        var stagedFamilyPath = StageParameterizedFamilyDocument(
            nameof(Parameter_assignment_paths_can_repeat_on_staged_family_document));

        var summary = RevitBenchmarkHarness.RunDocumentLoop(
            _dbApplication,
            nameof(Parameter_assignment_paths_can_repeat_on_staged_family_document),
            DefaultIterations,
            stagedFamilyPath,
            (_, familyDocument) => {
                Assert.That(familyDocument.IsFamilyDocument, Is.True);

                var familyTypes = new[] { "Type-A", "Type-B", "Type-C" };
                var fastGlobal = MeasureAssignmentPath(familyDocument, () =>
                    ParameterAssignmentHarness.RunGlobalValueAssignment(
                        familyDocument,
                        "FlowLabel",
                        "Supply",
                        familyTypes,
                        0));
                var perTypeDirect = MeasureAssignmentPath(familyDocument, () =>
                    ParameterAssignmentHarness.RunPerTypeValueAssignment(
                        familyDocument,
                        "NominalLength",
                        new Dictionary<string, string>(StringComparer.Ordinal) {
                            ["Type-A"] = "1.25",
                            ["Type-B"] = "2.5",
                            ["Type-C"] = "3.75"
                        },
                        0));

                var allSnapshots = RevitFamilyFixtureHarness.CaptureParameterSnapshots(
                    familyDocument,
                    "NominalLength",
                    familyTypes);
                Assert.That(allSnapshots, Has.Count.EqualTo(familyTypes.Length));
                Assert.That(allSnapshots.All(snapshot => snapshot.HasValue), Is.True);

                return new ParameterAssignmentBenchmarkResult(
                    fastGlobal,
                    perTypeDirect,
                    allSnapshots);
            });

        Assert.That(summary.Iterations, Has.Count.EqualTo(DefaultIterations));
        Assert.That(summary.Iterations.All(iteration => iteration.Result.GlobalValueFastPath.HasValue), Is.True);
        Assert.That(summary.Iterations.All(iteration => iteration.Result.PerTypeCoercionPath.HasValue), Is.True);
        TestContext.Progress.WriteLine(ParameterAssignmentBenchmarkResult.FormatSummary(summary));
    }

    private string StageGenericFamilyDocument(string testName) {
        var stageDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{testName}-seed");
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            _dbApplication,
            TestFamilyCategory,
            $"{testName}-Seed");

        try {
            return RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                stageDirectory,
                $"{testName}-seed");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    private string StageGenericProjectDocument(string testName) {
        var stageDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{testName}-project-seed");
        var projectDocument = RevitFamilyFixtureHarness.CreateProjectDocument(_dbApplication);

        try {
            return RevitFamilyFixtureHarness.SaveDocumentCopy(
                projectDocument,
                stageDirectory,
                $"{testName}-seed");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(projectDocument);
        }
    }

    private string StageParameterizedFamilyDocument(string testName) {
        var stageDirectory = RevitFamilyFixtureHarness.CreateTemporaryOutputDirectory($"{testName}-parameter-seed");
        var familyDocument = RevitFamilyFixtureHarness.CreateFamilyDocument(
            _dbApplication,
            TestFamilyCategory,
            $"{testName}-Seed");

        try {
            using var transaction = new Transaction(familyDocument, "Seed parameter benchmark family");
            _ = transaction.Start();

            _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                familyDocument,
                new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                    "NominalLength",
                    SpecTypeId.Length,
                    GroupTypeId.Geometry,
                    false));
            _ = RevitFamilyFixtureHarness.AddFamilyParameter(
                familyDocument,
                new RevitFamilyFixtureHarness.ParameterDefinitionSpec(
                    "FlowLabel",
                    SpecTypeId.String.Text,
                    GroupTypeId.IdentityData,
                    false));

            foreach (var typeName in new[] { "Type-A", "Type-B", "Type-C" })
                RevitFamilyFixtureHarness.EnsureFamilyType(familyDocument, typeName);

            _ = transaction.Commit();
            return RevitFamilyFixtureHarness.SaveDocumentCopy(
                familyDocument,
                stageDirectory,
                $"{testName}-seed");
        } finally {
            RevitFamilyFixtureHarness.CloseDocument(familyDocument);
        }
    }

    private static ParameterAssignmentHarness.AssignmentBenchmarkResult MeasureAssignmentPath(
        Document familyDocument,
        Func<ParameterAssignmentHarness.AssignmentBenchmarkResult> action
    ) {
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var result = action();
        stopwatch.Stop();
        return result with { IterationActionMs = stopwatch.Elapsed.TotalMilliseconds };
    }

    private static FFMigratorSettings CreateBenchmarkMigratorProfile() =>
        new() {
            ExecutionOptions = new ExecutionOptions {
                SingleTransaction = false,
                OptimizeTypeOperations = true,
                EnableCollectors = true
            },
            FilterFamilies = new BaseProfileSettings.FilterFamiliesSettings {
                IncludeUnusedFamilies = true,
                IncludeNames = new IncludeFamilies { StartingWith = [""] },
                ExcludeNames = new ExcludeFamilies()
            },
            FilterApsParams = new BaseProfileSettings.FilterApsParamsSettings {
                IncludeNames = new IncludeSharedParameter(),
                ExcludeNames = new ExcludeSharedParameter()
            },
            CleanFamilyDocument = new CleanFamilyDocumentSettings { Enabled = false },
            AddAndMapSharedParams = new MapParamsSettings {
                Enabled = false,
                DisablePerTypeFallback = true,
                MappingData = []
            },
            AddFamilyParams = new AddFamilyParamsSettings { Enabled = false, Parameters = [] },
            SetKnownParams = new SetKnownParamsSettings { Enabled = false },
            MakeElectricalConnector = new MakeElecConnectorSettings { Enabled = false },
            SortParams = new SortParamsSettings { Enabled = true }
        };
}

internal sealed record FamilyRoundtripBenchmarkResult(
    double ProcessMs,
    int PostProcessParameterCount,
    string SavedFamilyPath
);

internal sealed record LoadedFamiliesMatrixBenchmarkResult(
    int FamilyCount,
    int VisibleParameterCount,
    int IssueCount,
    IReadOnlyList<string> ProgressLines
);

internal sealed record MigratorStyleBenchmarkResult(
    double ProcessMs,
    int ContextCount,
    int OutputFamilyCount,
    IReadOnlyList<string> TargetFamilyNames
);

internal sealed record ParameterAssignmentBenchmarkResult(
    ParameterAssignmentHarness.AssignmentBenchmarkResult GlobalValueFastPath,
    ParameterAssignmentHarness.AssignmentBenchmarkResult PerTypeCoercionPath,
    IReadOnlyList<RevitFamilyFixtureHarness.ParameterValueSnapshot> NominalLengthSnapshots
) {
    public static string FormatSummary(BenchmarkLoopResult<ParameterAssignmentBenchmarkResult> summary) {
        var globalAvg = summary.Iterations.Average(iteration => iteration.Result.GlobalValueFastPath.IterationActionMs);
        var perTypeAvg = summary.Iterations.Average(iteration => iteration.Result.PerTypeCoercionPath.IterationActionMs);
        var typeCount = summary.Iterations.First().Result.NominalLengthSnapshots.Count;
        return $"[{summary.Name}] ParameterAssignment Summary: Iterations={summary.Iterations.Count}, TypeCount={typeCount}, AvgGlobalMs={globalAvg:F1}, AvgPerTypeMs={perTypeAvg:F1}";
    }
}
