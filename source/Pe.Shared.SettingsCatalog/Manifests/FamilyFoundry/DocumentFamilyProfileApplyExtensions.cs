using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Plans;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global;
using Pe.Revit.Global.Utils.Files;
using Pe.Shared.StorageRuntime;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;

namespace Pe.Revit.FamilyFoundry.Apply;

public static class DocumentFamilyProfileApplyExtensions {
    public static FamilyProfileApplyResult ApplyFamilyProfile(
        this Document doc,
        FFManagerProfile profile,
        string profileName,
        LoadAndSaveOptions? onFinishSettings = null,
        OutputStorage? runOutput = null,
        ExecutionOptions? executionOptionsOverride = null
    ) {
        if (doc == null)
            return new FamilyProfileApplyResult(false, "No document provided.", [], 0, null);

        try {
            var apsParamModels = profile.GetFilteredApsParamModels();

            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = BaseProfile.ConvertToSharedParameterDefinitions(apsParamModels, tempFile);

            var queue = BuildManagerQueue(profile, apsParamData);
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = false,
                SaveFamilyToInternalPath = false,
                SaveFamilyToOutputDir = false
            };

            var executionOptions = executionOptionsOverride ?? new ExecutionOptions {
                SingleTransaction = false,
                OptimizeTypeOperations = false
            };
            var capturePipeline = new SnapshotCapturePipeline()
                .Add(new ParameterSnapshotCollector())
                .Add(new LookupTableSnapshotCollector())
                .Add(new ReferencePlaneSnapshotCollector())
                .Add(new ParamDrivenSolidsSnapshotCollector());

            using var processor = new OperationProcessor(doc, executionOptions);
            var logs = processor
                .SelectFamilies(() => null)
                .ProcessQueue(queue, capturePipeline, runOutput?.DirectoryPath, finishSettings);

            if (runOutput != null) {
                var resultBuilder = new ProcessingResultBuilder(runOutput)
                    .WithProfile(profile, profileName)
                    .WithOperationMetadata(queue);

                foreach (var context in logs.contexts)
                    _ = resultBuilder.WriteSingleFamilyOutput(context, finishSettings.OpenOutputFilesOnCommandFinish);

                if (logs.contexts.Count > 1)
                    resultBuilder.WriteMultiFamilySummary(logs.totalMs, finishSettings.OpenOutputFilesOnCommandFinish);
            }

            var errors = logs.contexts
                .Select(context => context.OperationLogs.AsTuple().error)
                .Where(error => error != null)
                .ToList();

            return new FamilyProfileApplyResult(
                errors.Count == 0,
                errors.FirstOrDefault()?.Message,
                logs.contexts,
                logs.totalMs,
                runOutput?.DirectoryPath
            );
        } catch (Exception ex) {
            return new FamilyProfileApplyResult(
                false,
                ex.Message,
                [],
                0,
                runOutput?.DirectoryPath
            );
        }
    }

    public static FamilyMigrationApplyResult ApplyFamilyMigrationProfile(
        this Document doc,
        FFMigratorProfile profile,
        string profileName,
        IEnumerable<Family>? selectedFamilies = null,
        LoadAndSaveOptions? onFinishSettings = null,
        OutputStorage? runOutput = null
    ) {
        if (doc == null)
            return new FamilyMigrationApplyResult(false, "No document.", null, [], 0, 0);

        try {
            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = BaseProfile.ConvertToSharedParameterDefinitions(
                profile.GetFilteredApsParamModels(),
                tempFile
            );
            var queue = BuildMigrationQueue(profile, apsParamData);
            var capturePipeline = new SnapshotCapturePipeline()
                .Add(new ParameterSnapshotCollector())
                .Add(new LookupTableSnapshotCollector())
                .Add(new ReferencePlaneSnapshotCollector());
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false };

            var resultBuilder = runOutput == null
                ? null
                : new ProcessingResultBuilder(runOutput)
                    .WithProfile(profile, profileName)
                    .WithOperationMetadata(queue);
            using var processor = new OperationProcessor(doc, profile.ExecutionOptions);
            var explicitFamilies = selectedFamilies?
                .Where(family => family != null)
                .GroupBy(family => family.Id)
                .Select(group => group.First())
                .ToList();
            var logs = processor
                .SelectFamilies(() =>
                    explicitFamilies is { Count: > 0 }
                        ? explicitFamilies
                        : profile.GetFamilies(doc))
                .ProcessQueue(queue, capturePipeline, resultBuilder?.RunOutputPath, finishSettings);
            if (resultBuilder != null) {
                foreach (var familyCtx in logs.contexts)
                    _ = resultBuilder.WriteSingleFamilyOutput(familyCtx);

                resultBuilder.WriteMultiFamilySummary(logs.totalMs, finishSettings.OpenOutputFilesOnCommandFinish);
            }

            var processedFamilyNames = logs.contexts
                .Select(context => context.FamilyName)
                .Where(name => !string.IsNullOrWhiteSpace(name) &&
                               !string.Equals(name, "ERROR", StringComparison.OrdinalIgnoreCase))
                .ToList();
            var errors = logs.contexts
                .Select(context => context.OperationLogs.AsTuple().error)
                .Where(error => error != null)
                .ToList();
            var hasErrors = errors.Count > 0;

            return new FamilyMigrationApplyResult(
                !hasErrors,
                hasErrors ? errors.FirstOrDefault()?.Message ?? "Processing completed with errors." : null,
                resultBuilder?.RunOutputPath,
                processedFamilyNames,
                logs.totalMs,
                logs.contexts.Count
            );
        } catch (Exception ex) {
            return new FamilyMigrationApplyResult(false, ex.Message, runOutput?.DirectoryPath, [], 0, 0);
        }
    }

    private static OperationQueue BuildManagerQueue(
        FFManagerProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var specs = new List<RefPlaneSubcategorySpec> {
            new() { Strength = RpStrength.WeakRef, Name = "WeakRef", Color = new Color(217, 124, 0) },
            new() { Strength = RpStrength.StrongRef, Name = "StrongRef", Color = new Color(255, 0, 0) },
            new() { Strength = RpStrength.CenterLR, Name = "Center", Color = new Color(115, 0, 253) },
            new() { Strength = RpStrength.CenterFB, Name = "Center", Color = new Color(115, 0, 253) }
        };

        var hasProcessedAtParam = profile.AddFamilyParams.Parameters.Any(parameter =>
            string.Equals(parameter.Name, "_FOUNDRY LAST PROCESSED AT", StringComparison.OrdinalIgnoreCase));
        var hasProcessedAtAssignment = profile.SetKnownParams.GlobalAssignments.Any(assignment =>
            string.Equals(assignment.Parameter, "_FOUNDRY LAST PROCESSED AT", StringComparison.OrdinalIgnoreCase));

        if (!hasProcessedAtParam) {
            profile.AddFamilyParams.AddParameters([
                new FamilyParamDefinitionModel {
                    Name = "_FOUNDRY LAST PROCESSED AT",
                    DataType = SpecTypeId.String.Text
                }
            ]);
        }

        if (!hasProcessedAtAssignment) {
            profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
                Parameter = "_FOUNDRY LAST PROCESSED AT",
                Kind = ParamAssignmentKind.Formula,
                Value = $"\"{DateTime.Now:yyyy-MM-dd HH:mm:ss}\""
            });
        }

        var solidsPlan = AuthoredParamDrivenSolidsCompiler.Compile(profile.ParamDrivenSolids);
        if (!solidsPlan.CanExecute) {
            throw new InvalidOperationException(
                string.Join(Environment.NewLine, ParamDrivenSolidsDiagnosticFormatter.ToDisplayMessages(solidsPlan.Diagnostics)));
        }

        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(solidsPlan.Connectors))
            .ToList();
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profile.AddFamilyParams,
            profile.SetKnownParams,
            apsParamData,
            additionalReferences
        );

        var compilerMessages = solidsPlan.Diagnostics
            .Where(diagnostic => diagnostic.Severity == ParamDrivenDiagnosticSeverity.Warning)
            .Select(diagnostic => diagnostic.ToDisplayMessage())
            .ToList();

        var valueFirstAssignments = BuildValueFirstAssignments(knownParamPlan.ResolvedAssignments);
        var formulaOnlyAssignments = BuildFormulaOnlyAssignments(knownParamPlan.ResolvedAssignments);

        return new OperationQueue()
            .Add(new AddSharedParams(apsParamData))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new SetLookupTables(profile.SetLookupTables))
            .Add(new SetKnownParams(valueFirstAssignments, knownParamPlan.Catalog, true))
            .Add(new EmitParamDrivenSolidsDiagnostics(new EmitParamDrivenSolidsDiagnosticsSettings {
                Enabled = compilerMessages.Count > 0,
                Messages = compilerMessages
            }))
            .Add(new MakeParamDrivenPlanesAndDims(solidsPlan.RefPlanesAndDims))
            .Add(new SetKnownParams(formulaOnlyAssignments, knownParamPlan.Catalog))
            .Add(new MakeConstrainedExtrusions(solidsPlan.InternalExtrusions))
            .Add(new MakeParamDrivenConnectors(solidsPlan.Connectors))
            .Add(new MakeRefPlaneSubcategories(specs))
            .Add(new SortParams(new SortParamsSettings()));
    }

    private static OperationQueue BuildMigrationQueue(
        FFMigratorProfile profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var profileClone = DeepCloneProfile(profile);
        var apsParamNames = apsParamData.Select(parameter => parameter.ExternalDefinition.Name).ToList();
        var mappingDataAllNames = profileClone.AddAndMapSharedParams.MappingData
            .SelectMany(mapping => mapping.CurrNames)
            .Concat(apsParamNames);
        var internalParams = BuildInternalParams(profileClone)
            .Where(internalParam => profileClone.AddFamilyParams.Parameters.All(existing =>
                !string.Equals(existing.Name, internalParam.Name, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        profileClone.AddFamilyParams.AddParameters(internalParams);
        var additionalReferences = profileClone.MakeElectricalConnector.Enabled
            ? KnownParamPlanBuilder.CollectReferencedParameterNames(profileClone.MakeElectricalConnector)
            : [];
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profileClone.AddFamilyParams,
            profileClone.SetKnownParams,
            apsParamData,
            additionalReferences
        );
        var apsAndAddedParamNames = apsParamNames
            .Concat(knownParamPlan.ResolvedFamilyParams.Parameters.Select(parameter => parameter.Name))
            .ToList();

        return new OperationQueue()
            .Add(new CleanFamilyDocument(profileClone.CleanFamilyDocument, mappingDataAllNames))
            .Add(new AddAndMapSharedParams(profileClone.AddAndMapSharedParams, apsParamData))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new SetKnownParams(knownParamPlan.ResolvedAssignments, knownParamPlan.Catalog))
            .Add(new MakeElecConnector(profileClone.MakeElectricalConnector))
            .Add(new PurgeParams(profileClone.CleanFamilyDocument.ResolvedPurgeParamsSettings, apsAndAddedParamNames))
            .Add(new SortParams(profileClone.SortParams));
    }

    private static SetKnownParamsSettings BuildValueFirstAssignments(SetKnownParamsSettings settings) =>
        new() {
            Enabled = settings.Enabled,
            OverrideExistingValues = settings.OverrideExistingValues,
            GlobalAssignments = settings.GlobalAssignments
                .Where(assignment => assignment.Kind == ParamAssignmentKind.Value)
                .ToList(),
            PerTypeAssignmentsTable = settings.PerTypeAssignmentsTable
        };

    private static SetKnownParamsSettings BuildFormulaOnlyAssignments(SetKnownParamsSettings settings) =>
        new() {
            Enabled = settings.Enabled,
            OverrideExistingValues = settings.OverrideExistingValues,
            GlobalAssignments = settings.GlobalAssignments
                .Where(assignment => assignment.Kind == ParamAssignmentKind.Formula)
                .ToList(),
            PerTypeAssignmentsTable = []
        };

    private static FFMigratorProfile DeepCloneProfile(FFMigratorProfile profile) {
        var settings = new JsonSerializerSettings {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            PreserveReferencesHandling = PreserveReferencesHandling.None,
            MaxDepth = 128
        };
        var json = JsonConvert.SerializeObject(profile, Formatting.None, settings);
        return JsonConvert.DeserializeObject<FFMigratorProfile>(json, settings)
               ?? throw new InvalidOperationException("Failed to clone FF migrator profile.");
    }

    private static List<FamilyParamDefinitionModel> BuildInternalParams(FFMigratorProfile profile) {
        List<FamilyParamDefinitionModel> paramList = [
            new() {
                Name = "_FOUNDRY LAST PROCESSED AT",
                PropertiesGroup = new ForgeTypeId(""),
                DataType = SpecTypeId.String.Text,
                IsInstance = false
            }
        ];
        profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
            Parameter = "_FOUNDRY LAST PROCESSED AT",
            Kind = ParamAssignmentKind.Formula,
            Value = $"\"{DateTime.Now:yyyy_MM_dd HH:mm:ss}\""
        });

        return paramList;
    }
}

public sealed record FamilyProfileApplyResult(
    bool Success,
    string? Error,
    List<FamilyProcessingContext> Contexts,
    double TotalMs,
    string? OutputFolderPath
);

public sealed record FamilyMigrationApplyResult(
    bool Success,
    string? Error,
    string? OutputFolderPath,
    List<string> ProcessedFamilyNames,
    double TotalMs,
    int FamilyCount
);
