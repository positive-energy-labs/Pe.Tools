using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Extensions.FamDocument.GetValue;
using Pe.Revit.Extensions.FamDocument.SetValue;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global.Revit.Lib.Families.LoadedFamilies.Collectors;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Core.Json;
using Pe.Tools.Commands.FamilyFoundry;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Pe.Tools.Benchmarks;

internal static class PracticalBenchmarks {
    internal const int DefaultIterations = 3;
    private const BuiltInCategory TestFamilyCategory = BuiltInCategory.OST_GenericModel;
    private const string WineGuardianIndoorProfileFixture = "wineguardian-ds050-indoor.json";
    private const string FamilyFoundryRoundtripBenchmarkName = "FF_manager_roundtrip_can_repeat_on_staged_generic_family_document";
    private const string LoadedFamiliesMatrixBenchmarkName = "Loaded_families_matrix_can_repeat_on_staged_project_document";
    private const string FamilyFoundryMigratorQueueBenchmarkName = "FF_migrator_style_queue_can_repeat_on_staged_project_document";
    private const string ParameterAssignmentPathsBenchmarkName = "Parameter_assignment_paths_can_repeat_on_staged_family_document";

    public static PracticalBenchmarkRunResult RunAll(
        UIApplication uiApplication,
        OutputStorage taskOutput,
        Action<string>? log = null
    ) {
        if (uiApplication == null)
            throw new ArgumentNullException(nameof(uiApplication));
        if (taskOutput == null)
            throw new ArgumentNullException(nameof(taskOutput));

        log ??= Console.WriteLine;
        BenchmarkArtifactWriter.WriteReadme(taskOutput);

        var runOutput = taskOutput.TimestampedSubDir("practical-benchmarks");
        var metadata = CreateRunMetadata(uiApplication, runOutput);
        _ = BenchmarkArtifactWriter.WriteRunMetadata(runOutput, metadata);
        using var warningSuppression = SuppressWarningsForBenchmarkRun(uiApplication.Application, log);

        var entries = new List<BenchmarkRunSummaryEntry>(4);
        RunSingle(
            PracticalBenchmarkDefinitions.FamilyFoundryRoundtrip,
            FamilyFoundryRoundtripBenchmarkName,
            () => RunFamilyFoundryRoundtrip(
                uiApplication.Application,
                DefaultIterations,
                log: log),
            metadata,
            runOutput,
            entries,
            log);
        RunSingle(
            PracticalBenchmarkDefinitions.LoadedFamiliesMatrix,
            LoadedFamiliesMatrixBenchmarkName,
            () => RunLoadedFamiliesMatrix(
                uiApplication.Application,
                DefaultIterations,
                log: log),
            metadata,
            runOutput,
            entries,
            log);
        RunSingle(
            PracticalBenchmarkDefinitions.FamilyFoundryMigratorQueue,
            FamilyFoundryMigratorQueueBenchmarkName,
            () => RunFamilyFoundryMigratorQueue(
                uiApplication.Application,
                DefaultIterations,
                log: log),
            metadata,
            runOutput,
            entries,
            log);
        RunSingle(
            PracticalBenchmarkDefinitions.ParameterAssignmentPaths,
            ParameterAssignmentPathsBenchmarkName,
            () => RunParameterAssignmentPaths(
                uiApplication.Application,
                DefaultIterations,
                log: log),
            metadata,
            runOutput,
            entries,
            log);

        _ = BenchmarkArtifactWriter.WriteRunSummary(runOutput, metadata, entries);
        return new PracticalBenchmarkRunResult(runOutput.DirectoryPath, entries);
    }

    public static BenchmarkLoopResult<FamilyRoundtripBenchmarkResult> RunFamilyFoundryRoundtrip(
        Autodesk.Revit.ApplicationServices.Application application,
        int iterations = DefaultIterations,
        OutputStorage? workingOutput = null,
        Action<string>? log = null
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var benchmarkOutput = workingOutput ?? CreateTemporaryWorkingOutput(FamilyFoundryRoundtripBenchmarkName);
        var profile = LoadProfileFixture(WineGuardianIndoorProfileFixture);
        var seedFamilyPath = StageGenericFamilyDocument(
            application,
            FamilyFoundryRoundtripBenchmarkName,
            benchmarkOutput.SubDir("seed"),
            "ffmgr-seed");

        return BenchmarkHarness.RunDocumentLoop(
            application,
            FamilyFoundryRoundtripBenchmarkName,
            iterations,
            seedFamilyPath,
            (iteration, familyDocument) => {
                if (!familyDocument.IsFamilyDocument)
                    throw new InvalidOperationException("Expected a family document.");

                var iterationOutput = benchmarkOutput.SubDir("iterations").SubDir($"iter-{iteration:00}");
                var result = CmdFFManager.ProcessFamiliesCore(
                    familyDocument,
                    profile,
                    $"{WineGuardianIndoorProfileFixture}-iter-{iteration:00}",
                    new LoadAndSaveOptions {
                        OpenOutputFilesOnCommandFinish = false,
                        LoadFamily = false,
                        SaveFamilyToInternalPath = true,
                        SaveFamilyToOutputDir = true
                    },
                    iterationOutput.DirectoryPath,
                    new ExecutionOptions {
                        SingleTransaction = false,
                        OptimizeTypeOperations = false,
                        EnableCollectors = true,
                        SuppressWarnings = true
                    });
                var context = ValidateSingleContextResult(result);
                var savedFamilyPath = GetExpectedSavedFamilyPath(result.OutputFolderPath!, familyDocument);
                EnsureSavedFamilyFileIsOpenable(application, savedFamilyPath);

                var parameterCount = context.PostProcessSnapshot?.Parameters?.Data?.Count ?? 0;
                if (parameterCount <= 0)
                    throw new InvalidOperationException("Processed family did not retain any post-process parameters.");

                return new FamilyRoundtripBenchmarkResult(
                    result.TotalMs,
                    parameterCount,
                    savedFamilyPath);
            },
            log);
    }

    public static BenchmarkLoopResult<LoadedFamiliesMatrixBenchmarkResult> RunLoadedFamiliesMatrix(
        Autodesk.Revit.ApplicationServices.Application application,
        int iterations = DefaultIterations,
        OutputStorage? workingOutput = null,
        Action<string>? log = null
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var benchmarkOutput = workingOutput ?? CreateTemporaryWorkingOutput(LoadedFamiliesMatrixBenchmarkName);
        var stagedProjectPath = StageGenericProjectDocument(application, LoadedFamiliesMatrixBenchmarkName, benchmarkOutput.SubDir("seed"));

        return BenchmarkHarness.RunDocumentLoop(
            application,
            LoadedFamiliesMatrixBenchmarkName,
            iterations,
            stagedProjectPath,
            (_, projectDocument) => {
                if (projectDocument.IsFamilyDocument)
                    throw new InvalidOperationException("Expected a project document.");

                var progressLines = new List<string>();
                var data = LoadedFamiliesMatrixCollector.Collect(projectDocument, null, progressLines.Add);
                var visibleParameterCount = data.Families.Sum(family => family.VisibleParameters.Count);

                if (data.Families.Count <= 1)
                    throw new InvalidOperationException("Loaded families matrix benchmark expected more than one family.");
                if (visibleParameterCount <= 0)
                    throw new InvalidOperationException("Loaded families matrix benchmark expected at least one visible parameter.");

                return new LoadedFamiliesMatrixBenchmarkResult(
                    data.Families.Count,
                    visibleParameterCount,
                    data.Issues.Count,
                    progressLines);
            },
            log);
    }

    public static BenchmarkLoopResult<MigratorStyleBenchmarkResult> RunFamilyFoundryMigratorQueue(
        Autodesk.Revit.ApplicationServices.Application application,
        int iterations = DefaultIterations,
        OutputStorage? workingOutput = null,
        Action<string>? log = null
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var benchmarkOutput = workingOutput ?? CreateTemporaryWorkingOutput(FamilyFoundryMigratorQueueBenchmarkName);
        var stagedProjectPath = StageGenericProjectDocument(application, FamilyFoundryMigratorQueueBenchmarkName, benchmarkOutput.SubDir("seed"));
        var profile = CreateBenchmarkMigratorProfile();
        var queue = CmdFFMigrator.BuildQueueCore(profile, []);
        var collectorQueue = new CollectorQueue()
            .Add(new ParamSectionCollector())
            .Add(new RefPlaneSectionCollector());

        return BenchmarkHarness.RunDocumentLoop(
            application,
            FamilyFoundryMigratorQueueBenchmarkName,
            iterations,
            stagedProjectPath,
            (iteration, projectDocument) => {
                if (projectDocument.IsFamilyDocument)
                    throw new InvalidOperationException("Expected a project document.");

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
                var targetFamilyNames = targetFamilies
                    .Select(family => family.Name)
                    .ToList();

                var iterationOutput = benchmarkOutput.SubDir("iterations").SubDir($"iter-{iteration:00}");
                using var processor = new OperationProcessor(projectDocument, profile.ExecutionOptions);
                var logs = processor
                    .SelectFamilies(() => targetFamilies)
                    .ProcessQueue(
                        queue,
                        collectorQueue,
                        iterationOutput.DirectoryPath,
                        new LoadAndSaveOptions {
                            OpenOutputFilesOnCommandFinish = false,
                            LoadFamily = false,
                            SaveFamilyToInternalPath = false,
                            SaveFamilyToOutputDir = true
                        });

                if (logs.contexts.Count != targetFamilies.Count)
                    throw new InvalidOperationException(
                        $"Expected {targetFamilies.Count} migrator contexts but received {logs.contexts.Count}.");

                var firstError = logs.contexts
                    .Select(context => context.OperationLogs.AsTuple().error)
                    .FirstOrDefault(error => error != null);
                if (firstError != null)
                    throw new InvalidOperationException(firstError.ToString());

                var outputFiles = Directory.GetFiles(iterationOutput.DirectoryPath, "*.rfa", SearchOption.AllDirectories);
                if (outputFiles.Length == 0)
                    throw new InvalidOperationException("Migrator benchmark did not produce any saved family files.");
                EnsureSavedFamilyFileIsOpenable(application, outputFiles[0]);

                return new MigratorStyleBenchmarkResult(
                    logs.totalMs,
                    logs.contexts.Count,
                    outputFiles.Length,
                    targetFamilyNames);
            },
            log);
    }

    public static BenchmarkLoopResult<ParameterAssignmentBenchmarkResult> RunParameterAssignmentPaths(
        Autodesk.Revit.ApplicationServices.Application application,
        int iterations = DefaultIterations,
        OutputStorage? workingOutput = null,
        Action<string>? log = null
    ) {
        if (application == null)
            throw new ArgumentNullException(nameof(application));

        var benchmarkOutput = workingOutput ?? CreateTemporaryWorkingOutput(ParameterAssignmentPathsBenchmarkName);
        var stagedFamilyPath = StageParameterizedFamilyDocument(
            application,
            ParameterAssignmentPathsBenchmarkName,
            benchmarkOutput.SubDir("seed"),
            "param-seed");

        return BenchmarkHarness.RunDocumentLoop(
            application,
            ParameterAssignmentPathsBenchmarkName,
            iterations,
            stagedFamilyPath,
            (_, familyDocument) => {
                if (!familyDocument.IsFamilyDocument)
                    throw new InvalidOperationException("Expected a family document.");

                return RunBenchmarkTransaction(
                    familyDocument,
                    "Run parameter assignment benchmark",
                    () => {
                        var familyTypes = new[] { "Type-A", "Type-B", "Type-C" };
                        var fastGlobal = MeasureAssignmentPath(() =>
                            RunGlobalValueAssignment(
                                familyDocument,
                                "FlowLabel",
                                "Supply",
                                familyTypes,
                                0));
                        var perTypeDirect = MeasureAssignmentPath(() =>
                            RunPerTypeValueAssignment(
                                familyDocument,
                                "NominalLength",
                                new Dictionary<string, string>(StringComparer.Ordinal) {
                                    ["Type-A"] = "1.25",
                                    ["Type-B"] = "2.5",
                                    ["Type-C"] = "3.75"
                                },
                                0));

                        var allSnapshots = CaptureParameterSnapshots(familyDocument, "NominalLength", familyTypes);
                        if (allSnapshots.Count != familyTypes.Length)
                            throw new InvalidOperationException("Did not capture all parameter assignment snapshots.");
                        if (allSnapshots.Any(snapshot => !snapshot.HasValue))
                            throw new InvalidOperationException("One or more parameter assignment snapshots did not have values.");

                        return new ParameterAssignmentBenchmarkResult(
                            fastGlobal,
                            perTypeDirect,
                            allSnapshots);
                    });
            },
            log);
    }

    private static void RunSingle<TResult>(
        BenchmarkDefinition definition,
        string benchmarkName,
        Func<BenchmarkLoopResult<TResult>> run,
        BenchmarkRunMetadataArtifact metadata,
        OutputStorage runOutput,
        ICollection<BenchmarkRunSummaryEntry> entries,
        Action<string> log
    ) {
        log($"Running benchmark '{definition.DisplayName}'...");

        try {
            var summary = run();
            entries.Add(BenchmarkArtifactWriter.WriteBenchmarkResult(runOutput, definition, benchmarkName, metadata, summary));
        } catch (Exception ex) {
            entries.Add(BenchmarkArtifactWriter.WriteBenchmarkFailure(runOutput, definition, benchmarkName, metadata, ex));
            log($"[{definition.Id}] FAILED: {ex.Message}");
        }
    }

    private static BenchmarkRunMetadataArtifact CreateRunMetadata(UIApplication uiApplication, OutputStorage runOutput) {
        var assemblyVersion = typeof(PracticalBenchmarks).Assembly
            .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
            ?? typeof(PracticalBenchmarks).Assembly.GetName().Version?.ToString()
            ?? "Unknown";

        return new BenchmarkRunMetadataArtifact(
            Path.GetFileName(runOutput.DirectoryPath),
            DateTimeOffset.UtcNow,
            runOutput.DirectoryPath,
            "Task Palette > Run Practical Benchmarks",
            assemblyVersion,
            uiApplication.Application.VersionNumber,
            Environment.MachineName,
            RuntimeInformation.OSDescription,
            "Install the matching Pe.Tools MSI before running these benchmarks.",
            [
                PracticalBenchmarkDefinitions.FamilyFoundryRoundtrip.Id,
                PracticalBenchmarkDefinitions.LoadedFamiliesMatrix.Id,
                PracticalBenchmarkDefinitions.FamilyFoundryMigratorQueue.Id,
                PracticalBenchmarkDefinitions.ParameterAssignmentPaths.Id
            ]);
    }

    private static OutputStorage CreateTemporaryWorkingOutput(string benchmarkName) {
        var shortSegment = SanitizePathSegment(benchmarkName);
        if (shortSegment.Length > 24)
            shortSegment = shortSegment[..24];

        var path = Path.Combine(
            Path.GetTempPath(),
            "pe-benchmarks",
            shortSegment,
            Guid.NewGuid().ToString("N")[..8]);
        Directory.CreateDirectory(path);
        return OutputStorage.ExactDir(path);
    }

    private static string StageGenericFamilyDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        string benchmarkName,
        OutputStorage seedOutput,
        string familyName
    ) {
        var familyDocument = CreateFamilyDocument(application, TestFamilyCategory, familyName);

        try {
            return SaveDocumentCopy(familyDocument, seedOutput.DirectoryPath, familyName);
        } finally {
            CloseDocument(familyDocument);
        }
    }

    private static string StageGenericProjectDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        string benchmarkName,
        OutputStorage seedOutput
    ) {
        var projectDocument = CreateProjectDocument(application);

        try {
            return SaveDocumentCopy(projectDocument, seedOutput.DirectoryPath, $"{benchmarkName}-seed");
        } finally {
            CloseDocument(projectDocument);
        }
    }

    private static string StageParameterizedFamilyDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        string benchmarkName,
        OutputStorage seedOutput,
        string familyName
    ) {
        var familyDocument = CreateFamilyDocument(application, TestFamilyCategory, familyName);

        try {
            using var transaction = new Transaction(familyDocument, "Seed parameter benchmark family");
            _ = transaction.Start();

            _ = AddFamilyParameter(
                familyDocument,
                new ParameterDefinitionSpec("NominalLength", SpecTypeId.Length, GroupTypeId.Geometry, false));
            _ = AddFamilyParameter(
                familyDocument,
                new ParameterDefinitionSpec("FlowLabel", SpecTypeId.String.Text, GroupTypeId.IdentityData, false));

            foreach (var typeName in new[] { "Type-A", "Type-B", "Type-C" })
                _ = EnsureFamilyType(familyDocument, typeName);

            _ = transaction.Commit();
            return SaveDocumentCopy(familyDocument, seedOutput.DirectoryPath, familyName);
        } finally {
            CloseDocument(familyDocument);
        }
    }

    private static IDisposable SuppressWarningsForBenchmarkRun(
        Autodesk.Revit.ApplicationServices.Application application,
        Action<string> log
    ) {
        void OnFailuresProcessing(object? _, Autodesk.Revit.DB.Events.FailuresProcessingEventArgs args) {
            var accessor = args.GetFailuresAccessor();
            if (accessor == null)
                return;

            var warningMessages = accessor.GetFailureMessages()
                .Where(message => message.GetSeverity() == FailureSeverity.Warning)
                .ToList();
            if (warningMessages.Count == 0)
                return;

            foreach (var warningMessage in warningMessages) {
                var description = warningMessage.GetDescriptionText();
                if (!string.IsNullOrWhiteSpace(description))
                    log($"Suppressed Revit warning: {description}");

                accessor.DeleteWarning(warningMessage);
            }

            args.SetProcessingResult(FailureProcessingResult.Continue);
        }

        application.FailuresProcessing += OnFailuresProcessing;
        return new DelegateDisposable(() => application.FailuresProcessing -= OnFailuresProcessing);
    }

    private static string ResolveGenericModelTemplatePath(Autodesk.Revit.ApplicationServices.Application application) {
        var templateRoot = application.FamilyTemplatePath;
        var candidates = new[] {
                string.Empty,
                "English-Imperial",
                "English_I",
                "English",
                Path.Combine("Family Templates", "English-Imperial"),
                Path.Combine("Family Templates", "English_I"),
                Path.Combine("Family Templates", "English")
            }
            .Select(subdirectory => string.IsNullOrWhiteSpace(subdirectory)
                ? Path.Combine(templateRoot, "Generic Model.rft")
                : Path.Combine(templateRoot, subdirectory, "Generic Model.rft"))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var resolved = candidates.FirstOrDefault(File.Exists);
        if (!string.IsNullOrWhiteSpace(resolved))
            return resolved;

        throw new FileNotFoundException(
            $"Family template not found. Application.FamilyTemplatePath='{templateRoot}'. Tried: {string.Join("; ", candidates)}");
    }

    private static Document CreateFamilyDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        BuiltInCategory familyCategory,
        string familyName
    ) {
        var templatePath = ResolveGenericModelTemplatePath(application);
        var document = application.NewFamilyDocument(templatePath)
            ?? throw new InvalidOperationException($"Failed to create family document from template '{templatePath}'.");
        if (!document.IsFamilyDocument)
            throw new InvalidOperationException($"Template '{templatePath}' did not create a family document.");

        using var transaction = new Transaction(document, "Configure owner family");
        _ = transaction.Start();
        document.OwnerFamily.Name = familyName;
        document.OwnerFamily.FamilyCategory = Category.GetCategory(document, familyCategory);
        _ = transaction.Commit();

        return document;
    }

    private static Document CreateProjectDocument(
        Autodesk.Revit.ApplicationServices.Application application,
        UnitSystem unitSystem = UnitSystem.Imperial
    ) {
        var defaultTemplatePath = application.DefaultProjectTemplate;
        var document = !string.IsNullOrWhiteSpace(defaultTemplatePath) && File.Exists(defaultTemplatePath)
            ? application.NewProjectDocument(defaultTemplatePath)
            : application.NewProjectDocument(unitSystem);
        if (document == null)
            throw new InvalidOperationException($"Failed to create project document for unit system '{unitSystem}'.");
        if (document.IsFamilyDocument)
            throw new InvalidOperationException("Expected a project document.");

        return document;
    }

    private static string SaveDocumentCopy(Document document, string outputDirectory, string fileNameStem) {
        Directory.CreateDirectory(outputDirectory);

        var extension = document.IsFamilyDocument ? ".rfa" : ".rvt";
        var safeFileNameStem = SanitizePathSegment(fileNameStem.Trim());
        var savePath = Path.Combine(outputDirectory, $"{safeFileNameStem}{extension}");
        document.SaveAs(
            savePath,
            new SaveAsOptions {
                OverwriteExistingFile = true,
                Compact = true,
                MaximumBackups = 1
            });
        return savePath;
    }

    private static string GetExpectedSavedFamilyPath(string outputDirectory, Document familyDocument) {
        var familyName = familyDocument.OwnerFamily?.Name;
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = Path.GetFileNameWithoutExtension(familyDocument.Title);
        if (string.IsNullOrWhiteSpace(familyName))
            familyName = "Family";

        var safeFamilyName = SanitizePathSegment(familyName);
        return Path.Combine(outputDirectory, safeFamilyName, $"{safeFamilyName}.rfa");
    }

    private static FFManagerSettings LoadProfileFixture(string fixtureFileName) {
        var assemblyDirectory = Path.GetDirectoryName(typeof(PracticalBenchmarks).Assembly.Location)
                                ?? throw new InvalidOperationException("Could not resolve the app assembly directory.");
        var fixturePath = Path.Combine(assemblyDirectory, "Benchmarks", "Profiles", fixtureFileName);
        if (!File.Exists(fixturePath))
            throw new FileNotFoundException($"Profile fixture not found at '{fixturePath}'.", fixturePath);

        var json = File.ReadAllText(fixturePath);
        var settings = RevitJsonFormatting.CreateRevitIndentedSettings();

        if (!settings.Converters.OfType<StringEnumConverter>().Any())
            settings.Converters.Add(new StringEnumConverter());

        return JsonConvert.DeserializeObject<FFManagerSettings>(json, settings)
               ?? throw new InvalidOperationException($"Failed to deserialize profile fixture '{fixturePath}'.");
    }

    private static void EnsureSavedFamilyFileIsOpenable(
        Autodesk.Revit.ApplicationServices.Application application,
        string savedFamilyPath
    ) {
        if (!File.Exists(savedFamilyPath))
            throw new FileNotFoundException($"Saved family file not found at '{savedFamilyPath}'.", savedFamilyPath);

        Document? savedDocument = null;

        try {
            savedDocument = application.OpenDocumentFile(savedFamilyPath)
                ?? throw new InvalidOperationException($"Failed to open saved family '{savedFamilyPath}'.");
            if (!savedDocument.IsFamilyDocument)
                throw new InvalidOperationException($"Saved file '{savedFamilyPath}' did not reopen as a family document.");
            if (savedDocument.OwnerFamily == null)
                throw new InvalidOperationException($"Saved family '{savedFamilyPath}' did not expose an owner family.");
        } finally {
            CloseDocument(savedDocument);
        }
    }

    private static void CloseDocument(Document? document) {
        if (document == null || !document.IsValidObject)
            return;

        _ = document.Close(false);
    }

    private static FamilyParameter AddFamilyParameter(Document familyDocument, ParameterDefinitionSpec parameter) {
        var familyDoc = new FamilyDocument(familyDocument);
        return familyDoc.AddFamilyParameter(
            parameter.Name,
            parameter.Group ?? new ForgeTypeId(string.Empty),
            parameter.DataType,
            parameter.IsInstance);
    }

    private static FamilyType EnsureFamilyType(Document familyDocument, string typeName) {
        var familyManager = familyDocument.FamilyManager;
        return familyManager.Types
                   .Cast<FamilyType>()
                   .FirstOrDefault(type => string.Equals(type.Name, typeName, StringComparison.Ordinal))
               ?? familyManager.NewType(typeName);
    }

    private static void SetCurrentType(Document familyDocument, string typeName) =>
        familyDocument.FamilyManager.CurrentType = EnsureFamilyType(familyDocument, typeName);

    private static IReadOnlyList<ParameterValueSnapshot> CaptureParameterSnapshots(
        Document familyDocument,
        string parameterName,
        IReadOnlyList<string> typeNames
    ) {
        var familyDoc = new FamilyDocument(familyDocument);
        var parameter = familyDocument.FamilyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");
        var snapshots = new List<ParameterValueSnapshot>(typeNames.Count);

        foreach (var typeName in typeNames.Distinct(StringComparer.Ordinal)) {
            SetCurrentType(familyDocument, typeName);
            familyDocument.Regenerate();
            snapshots.Add(new ParameterValueSnapshot(
                typeName,
                parameter.Formula,
                familyDoc.GetValue(parameter),
                familyDoc.GetValueString(parameter),
                familyDoc.HasValue(parameter),
                parameter.StorageType,
                parameter.Definition.GetDataType().TypeId));
        }

        return snapshots;
    }

    private static FamilyProcessingContext ValidateSingleContextResult(FFManagerProcessFamiliesActionResult result) {
        if (!result.Success)
            throw new InvalidOperationException(result.Error ?? "Family Foundry roundtrip failed.");
        if (result.Contexts.Count != 1)
            throw new InvalidOperationException($"Expected one context but received {result.Contexts.Count}.");
        if (string.IsNullOrWhiteSpace(result.OutputFolderPath))
            throw new InvalidOperationException("Family Foundry roundtrip did not return an output folder path.");
        if (result.Contexts[0].PostProcessSnapshot == null)
            throw new InvalidOperationException("Family Foundry roundtrip did not produce a post-process snapshot.");

        return result.Contexts[0];
    }

    private static AssignmentBenchmarkResult MeasureAssignmentPath(Func<AssignmentBenchmarkResult> action) {
        var stopwatch = Stopwatch.StartNew();
        var result = action();
        stopwatch.Stop();
        return result with { IterationActionMs = stopwatch.Elapsed.TotalMilliseconds };
    }

    private static TResult RunBenchmarkTransaction<TResult>(
        Document document,
        string transactionName,
        Func<TResult> action
    ) {
        using var transaction = new Transaction(document, transactionName);
        _ = transaction.Start();

        var failureOptions = transaction.GetFailureHandlingOptions();
        failureOptions.SetFailuresPreprocessor(new BenchmarkWarningSuppressingFailuresPreprocessor());
        failureOptions.SetForcedModalHandling(false);
        transaction.SetFailureHandlingOptions(failureOptions);

        var result = action();
        _ = transaction.Commit();
        return result;
    }

    private static AssignmentBenchmarkResult RunGlobalValueAssignment(
        Document familyDocument,
        string parameterName,
        string value,
        IReadOnlyList<string> typeNames,
        double iterationActionMs
    ) {
        var familyDoc = new FamilyDocument(familyDocument);
        var parameter = familyDocument.FamilyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

        if (!familyDoc.TrySetUnsetFormula(parameter, value, out var errorMessage)) {
            throw new InvalidOperationException(
                $"Global value assignment failed for '{parameterName}': {errorMessage}");
        }

        SetCurrentType(familyDocument, typeNames[0]);
        familyDocument.Regenerate();

        return new AssignmentBenchmarkResult(
            "GlobalValueFastPath",
            parameterName,
            typeNames.Count,
            parameter.Formula,
            familyDoc.GetValue(parameter),
            familyDoc.GetValueString(parameter),
            familyDoc.HasValue(parameter),
            iterationActionMs);
    }

    private static AssignmentBenchmarkResult RunPerTypeValueAssignment(
        Document familyDocument,
        string parameterName,
        IReadOnlyDictionary<string, string> valuesByType,
        double iterationActionMs
    ) {
        var familyDoc = new FamilyDocument(familyDocument);
        var parameter = familyDocument.FamilyManager.get_Parameter(parameterName)
            ?? throw new InvalidOperationException($"Family parameter '{parameterName}' was not found.");

        foreach (var (typeName, value) in valuesByType) {
            SetCurrentType(familyDocument, typeName);
            _ = familyDoc.SetValue(parameter, value, nameof(BuiltInCoercionStrategy.CoerceByStorageType));
        }

        SetCurrentType(familyDocument, valuesByType.Keys.First());
        familyDocument.Regenerate();

        return new AssignmentBenchmarkResult(
            "PerTypeCoercionPath",
            parameterName,
            valuesByType.Count,
            parameter.Formula,
            familyDoc.GetValue(parameter),
            familyDoc.GetValueString(parameter),
            familyDoc.HasValue(parameter),
            iterationActionMs);
    }

    private static FFMigratorSettings CreateBenchmarkMigratorProfile() =>
        new() {
            ExecutionOptions = new ExecutionOptions {
                SingleTransaction = false,
                OptimizeTypeOperations = true,
                EnableCollectors = true,
                SuppressWarnings = true
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

    private static string SanitizePathSegment(string value) {
        var invalidChars = Path.GetInvalidFileNameChars().ToHashSet();
        var sanitized = new string(value.Select(ch => invalidChars.Contains(ch) ? '_' : ch).ToArray()).Trim();
        return string.IsNullOrWhiteSpace(sanitized) ? "artifact" : sanitized;
    }

    private sealed class BenchmarkWarningSuppressingFailuresPreprocessor : IFailuresPreprocessor {
        public FailureProcessingResult PreprocessFailures(FailuresAccessor failuresAccessor) {
            foreach (var failureMessage in failuresAccessor.GetFailureMessages()) {
                if (failureMessage.GetSeverity() != FailureSeverity.Warning)
                    continue;

                failuresAccessor.DeleteWarning(failureMessage);
            }

            return FailureProcessingResult.Continue;
        }
    }

    private sealed class DelegateDisposable(Action dispose) : IDisposable {
        private Action? _dispose = dispose;

        public void Dispose() {
            var action = Interlocked.Exchange(ref this._dispose, null);
            action?.Invoke();
        }
    }
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

internal sealed record AssignmentBenchmarkResult(
    string Label,
    string ParameterName,
    int TypeCount,
    string? Formula,
    object? RawValue,
    string? ValueString,
    bool HasValue,
    double IterationActionMs
);

internal sealed record ParameterDefinitionSpec(string Name, ForgeTypeId DataType, ForgeTypeId? Group = null, bool IsInstance = true);

internal sealed record ParameterValueSnapshot(
    string TypeName,
    string? Formula,
    object? RawValue,
    string? ValueString,
    bool HasValue,
    StorageType StorageType,
    string DataTypeId
);

internal sealed record ParameterAssignmentBenchmarkResult(
    AssignmentBenchmarkResult GlobalValueFastPath,
    AssignmentBenchmarkResult PerTypeCoercionPath,
    IReadOnlyList<ParameterValueSnapshot> NominalLengthSnapshots
) {
    public static string FormatSummary(BenchmarkLoopResult<ParameterAssignmentBenchmarkResult> summary) {
        var globalAvg = summary.Iterations.Average(iteration => iteration.Result.GlobalValueFastPath.IterationActionMs);
        var perTypeAvg = summary.Iterations.Average(iteration => iteration.Result.PerTypeCoercionPath.IterationActionMs);
        var typeCount = summary.Iterations.First().Result.NominalLengthSnapshots.Count;
        return $"[{summary.Name}] ParameterAssignment Summary: Iterations={summary.IterationCount}, TypeCount={typeCount}, AvgGlobalMs={globalAvg:F1}, AvgPerTypeMs={perTypeAvg:F1}";
    }
}
