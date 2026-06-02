using Pe.Revit.FamilyFoundry.DesiredState;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.Global;
using Pe.Revit.Global.Utils.Files;
using Pe.Shared.StorageRuntime;

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
            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = ResolveSharedParameterDefinitions(profile, profile, tempFile);
            var queue = FFManagerQueueBuilder.Build(profile, apsParamData);
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = false,
                SaveFamilyToInternalPath = false,
                SaveFamilyToOutputDir = false
            };

            var executionOptions = executionOptionsOverride ?? new ExecutionOptions {
                SingleTransaction = false, OptimizeTypeOperations = false
            };
            var capturePipeline = new SnapshotCapturePipeline()
                .Add(new ParameterSnapshotCollector())
                .Add(new LookupTableSnapshotCollector())
                .Add(new ReferencePlaneSnapshotCollector())
                .Add(new ParamDrivenSolidsSnapshotCollector());

            return FamilyProfileApplicator.ApplyProfile(
                doc,
                queue,
                profile,
                profileName,
                capturePipeline,
                finishSettings,
                runOutput,
                executionOptions);
        } catch (Exception ex) {
            return new FamilyProfileApplyResult(false, ex.Message, [], 0, runOutput?.DirectoryPath);
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
            var apsParamData = ResolveSharedParameterDefinitions(profile, profile, tempFile, profile.MappingData);
            var plan = DesiredParameterCompiler.Compile(profile, profile, apsParamData, profile.MappingData);
            var compiledProfile = DesiredMigrationPlanLowerer.LowerMigrator(profile, plan);
            var localMapParams = DesiredMigrationPlanLowerer.BuildLocalMapParams(plan);
            var queue = FFMigratorQueueBuilder.Build(compiledProfile, apsParamData, localMapParams, profile.ParamDrivenSolids);
            var capturePipeline = new SnapshotCapturePipeline()
                .Add(new ParameterSnapshotCollector())
                .Add(new LookupTableSnapshotCollector())
                .Add(new ReferencePlaneSnapshotCollector())
                .Add(new ParamDrivenSolidsSnapshotCollector());
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false };
            var explicitFamilies = selectedFamilies?
                .Where(family => family != null)
                .GroupBy(family => family.Id)
                .Select(group => group.First())
                .ToList();

            return FamilyProfileApplicator.ApplyMigrationProfile(
                doc,
                queue,
                profile,
                profileName,
                () => explicitFamilies is { Count: > 0 } ? explicitFamilies : profile.GetFamilies(doc),
                capturePipeline,
                finishSettings,
                runOutput,
                profile.ExecutionOptions,
                plan);
        } catch (Exception ex) {
            return new FamilyMigrationApplyResult(false, ex.Message, runOutput?.DirectoryPath, [], 0, 0);
        }
    }

    public static FamilyMigrationApplyResult ApplyDesiredFamilyMigrationProfile(
        this Document doc,
        DesiredFamilyMigrationProfile profile,
        string profileName,
        IEnumerable<Family>? selectedFamilies = null,
        LoadAndSaveOptions? onFinishSettings = null,
        OutputStorage? runOutput = null
    ) {
        if (doc == null)
            return new FamilyMigrationApplyResult(false, "No document.", null, [], 0, 0);

        try {
            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = ResolveSharedParameterDefinitions(profile, profile, tempFile, profile.MappingData);
            var buildResult = DesiredFamilyMigrationQueueBuilder.Build(profile, apsParamData);
            var capturePipeline = new SnapshotCapturePipeline()
                .Add(new ParameterSnapshotCollector())
                .Add(new LookupTableSnapshotCollector())
                .Add(new ReferencePlaneSnapshotCollector())
                .Add(new ParamDrivenSolidsSnapshotCollector());
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false };
            var explicitFamilies = selectedFamilies?
                .Where(family => family != null)
                .GroupBy(family => family.Id)
                .Select(group => group.First())
                .ToList();

            return FamilyProfileApplicator.ApplyMigrationProfile(
                doc,
                buildResult.Queue,
                profile,
                profileName,
                () => explicitFamilies is { Count: > 0 } ? explicitFamilies : profile.GetFamilies(doc),
                capturePipeline,
                finishSettings,
                runOutput,
                profile.ExecutionOptions,
                buildResult.Plan);
        } catch (Exception ex) {
            return new FamilyMigrationApplyResult(false, ex.Message, runOutput?.DirectoryPath, [], 0, 0);
        }
    }

    private static List<SharedParameterDefinition> ResolveSharedParameterDefinitions(
        BaseProfile profile,
        IDesiredParameterProfile parameterProfile,
        TempSharedParamFile tempFile,
        IEnumerable<MappingData>? mappingData = null
    ) {
        var explicitNames = DesiredParameterCompiler.GetExplicitSharedParameterNames(parameterProfile, mappingData);
        var requireCache = profile.SharedParameterSelection.HasIncludeFilters;
        var sharedParameters = BaseProfile.ConvertToSharedParameterDefinitions(
            profile.GetSelectedApsParamModels(explicitNames, requireCache),
            tempFile);
        sharedParameters.AddRange(BuildMissingSharedParameterDefinitions(
            parameterProfile,
            mappingData,
            tempFile,
            sharedParameters));
        return sharedParameters;
    }

    private static IEnumerable<SharedParameterDefinition> BuildMissingSharedParameterDefinitions(
        IDesiredParameterProfile parameterProfile,
        IEnumerable<MappingData>? mappingData,
        TempSharedParamFile tempFile,
        IReadOnlyCollection<SharedParameterDefinition> existingDefinitions
    ) {
        var existingNames = existingDefinitions
            .Select(parameter => parameter.ExternalDefinition.Name)
            .ToHashSet(StringComparer.Ordinal);
        var declarationsByName = parameterProfile.SharedParameters
            .Where(parameter => !string.IsNullOrWhiteSpace(parameter.Name))
            .GroupBy(parameter => parameter.Name.Trim(), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        var requiredNames = DesiredParameterCompiler.GetExplicitSharedParameterNames(parameterProfile, mappingData);

        foreach (var name in requiredNames) {
            if (existingNames.Contains(name))
                continue;

            declarationsByName.TryGetValue(name, out var declaration);
            var options = new ExternalDefinitionCreationOptions(
                name,
                declaration?.DataType ?? SpecTypeId.String.Text) {
                Description = declaration?.Tooltip ?? string.Empty
            };
            var definition = tempFile.TempGroup.Definitions.get_Item(name) as ExternalDefinition
                             ?? (ExternalDefinition)tempFile.TempGroup.Definitions.Create(options);
            yield return new SharedParameterDefinition(
                definition,
                declaration?.PropertiesGroup ?? GroupTypeId.IdentityData,
                declaration?.IsInstance ?? true);
        }
    }
}
