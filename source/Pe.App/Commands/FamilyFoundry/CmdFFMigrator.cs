using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.OperationGroups;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Resolution;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Ui;
using Pe.Global.Utils.Files;
using Pe.SettingsCatalog.Revit;
using Pe.SettingsCatalog.Revit.FamilyFoundry;
using Pe.StorageRuntime.Revit;
using Pe.StorageRuntime.Revit.Modules;
using Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.Tools.SettingsEditor;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using System.IO;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdFFMigrator : IExternalCommand {
    public const string AddinKey = nameof(CmdFFMigrator);
    public const string DisplayName = "FF Migrator";
    private static readonly CatalogSettingsModule<ProfileRemap> SettingsModule = KnownSettingsRevitModules.FFMigrator;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<ProfileRemap>(DisplayName, SettingsModule, doc, uiDoc)
                .WithAction("Open Settings Editor", this.HandleOpenSettingsEditor)
                .WithAction("Open Profile File", this.HandleOpenFile,
                    ctx => ctx.SelectedProfile != null)
                .WithAction("Process Families", this.HandleProcessFamilies,
                    ctx => ctx.PreviewData?.IsValid == true)
                .WithAction("Place Families", this.HandlePlaceFamilies,
                    ctx => ctx.SelectedProfile != null)
                .WithQueueBuilder(BuildQueueCore)
                .WithPostProcess((ctx, familyNames) =>
                    FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, familyNames, DisplayName))
                .Build();

            window.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void HandlePlaceFamilies(FoundryContext<ProfileRemap> context) {
        if (context.SelectedProfile == null) return;

        try {
            var profile = ReadProfile(
                context.SelectedProfile.TextPrimary,
                SettingsModule.DefaultSubDirectory
            );
            var placeResult = PlaceFamiliesCore(context.UiDoc.Application, profile);
            var level = placeResult.Success ? LogEventLevel.Information : LogEventLevel.Error;
            var message = placeResult.Success
                ? $"Placed {placeResult.PlacedCount} family entries for profile '{context.SelectedProfile.TextPrimary}'."
                : placeResult.Error ?? "Failed to place families.";
            new Ballogger().Add(level, new StackFrame(), message).Show();
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
        }
    }

    private void HandleOpenFile(FoundryContext<ProfileRemap> context) {
        if (context.SelectedProfile == null) return;
        var result = OpenProfileInDefaultApp(
            context.SelectedProfile.TextPrimary,
            SettingsModule.DefaultSubDirectory
        );
        var level = result.Success ? LogEventLevel.Information : LogEventLevel.Warning;
        var message = result.Success
            ? $"Opened profile file: {result.FilePath}"
            : result.Error ?? "Profile file could not be opened.";
        new Ballogger().Add(level, new StackFrame(), message).Show();
    }

    private void HandleProcessFamilies(FoundryContext<ProfileRemap> ctx) {
        if (ctx.SelectedProfile == null) return;
        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot process families - profile has validation errors")
                .Show();
            return;
        }

        var profile = ReadProfile(
            ctx.SelectedProfile.TextPrimary,
            SettingsModule.DefaultSubDirectory
        );
        var runResult = ProcessFamiliesCore(
            ctx.UiDoc.Application,
            profile,
            ctx.SelectedProfile.TextPrimary,
            ctx.OnFinishSettings
        );
        var level = runResult.Success ? LogEventLevel.Information : LogEventLevel.Error;
        var message = runResult.Success
            ? $"Processed {runResult.FamilyCount} families in {runResult.TotalMs:F0}ms."
            : runResult.Error ?? "Processing failed.";
        new Ballogger().Add(level, new StackFrame(), message).Show();
        if (runResult.ProcessedFamilyNames.Count > 0) {
            FamilyPlacementHelper.PromptAndPlaceFamilies(
                ctx.UiDoc.Application,
                runResult.ProcessedFamilyNames,
                DisplayName
            );
        }
    }

    private void HandleOpenSettingsEditor(FoundryContext<ProfileRemap> context) {
        var selectedProfileName = context.SelectedProfile?.TextPrimary;
        var launched = SettingsEditorBrowser.TryLaunch(
            SettingsModule.ModuleKey,
            SettingsModule.DefaultSubDirectory,
            selectedProfileName
        );
        if (launched) {
            new Ballogger()
                .Add(
                    LogEventLevel.Information,
                    new StackFrame(),
                    "Opened FF Migrator external settings-editor route in your default browser."
                )
                .Show();
            return;
        }

        new Ballogger()
            .Add(
                LogEventLevel.Warning,
                new StackFrame(),
                "Could not open external settings-editor route. Check PE_SETTINGS_EDITOR_BASE_URL."
            )
            .Show();
    }

    internal static FFMigratorPlaceFamiliesActionResult PlaceFamiliesCore(UIApplication uiApp, ProfileRemap profile) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null)
            return new FFMigratorPlaceFamiliesActionResult(false, "No active document.", [], 0);

        try {
            var familyNames = profile.GetFamilies(doc)
                .Select(f => f.Name)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (familyNames.Count == 0) {
                return new FFMigratorPlaceFamiliesActionResult(
                    false,
                    "No families matched the current profile settings.",
                    [],
                    0
                );
            }

            FamilyPlacementHelper.PromptAndPlaceFamilies(uiApp, familyNames, DisplayName);
            return new FFMigratorPlaceFamiliesActionResult(true, null, familyNames, familyNames.Count);
        } catch (Exception ex) {
            return new FFMigratorPlaceFamiliesActionResult(false, ex.Message, [], 0);
        }
    }

    internal static FFMigratorProcessFamiliesActionResult ProcessFamiliesCore(
        UIApplication uiApp,
        ProfileRemap profile,
        string profileName,
        LoadAndSaveOptions? onFinishSettings = null
    ) {
        var uiDoc = uiApp.ActiveUIDocument;
        var doc = uiDoc?.Document;
        if (doc == null || uiDoc == null) {
            return new FFMigratorProcessFamiliesActionResult(
                false,
                "No active document.",
                null,
                [],
                0,
                0
            );
        }

        var storage = new StorageClient(AddinKey);

        try {
            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
                profile.GetFilteredApsParamModels(),
                tempFile
            );
            var queue = BuildQueueCore(profile, apsParamData);
            var outputFolderPath = storage.OutputDir().DirectoryPath;
            var collectorQueue = new CollectorQueue()
                .Add(new ParamSectionCollector())
                .Add(new RefPlaneSectionCollector());
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false };

            var resultBuilder = new ProcessingResultBuilder(storage)
                .WithProfile(profile, profileName)
                .WithOperationMetadata(queue);
            using var processor = new OperationProcessor(doc, profile.ExecutionOptions);
            var logs = processor
                .SelectFamilies(() => {
                    var picked = Pickers.GetSelectedFamilies(uiDoc);
                    return picked.Any() ? picked : profile.GetFamilies(doc);
                })
                .WithPerFamilyCallback(familyCtx => resultBuilder.WriteSingleFamilyOutput(familyCtx))
                .ProcessQueue(queue, collectorQueue, outputFolderPath, finishSettings);

            resultBuilder.WriteMultiFamilySummary(logs.totalMs, finishSettings.OpenOutputFilesOnCommandFinish);
            var processedFamilyNames = logs.contexts
                .Select(c => c.FamilyName)
                .Where(name => !string.IsNullOrWhiteSpace(name) &&
                               !string.Equals(name, "ERROR", StringComparison.OrdinalIgnoreCase))
                .ToList();
            var hasErrors = logs.contexts.Any(ctx => {
                var (_, error) = ctx.OperationLogs;
                return error != null;
            });

            return new FFMigratorProcessFamiliesActionResult(
                !hasErrors,
                hasErrors ? "Processing completed with errors. Review generated logs." : null,
                outputFolderPath,
                processedFamilyNames,
                logs.totalMs,
                logs.contexts.Count
            );
        } catch (Exception ex) {
            return new FFMigratorProcessFamiliesActionResult(
                false,
                ex.Message,
                null,
                [],
                0,
                0
            );
        }
    }

    internal static OperationQueue BuildQueueCore(ProfileRemap profile, List<SharedParameterDefinition> apsParamData) {
        var pClone = DeepCloneProfile(profile);
        var apsParamNames = apsParamData.Select(p => p.ExternalDefinition.Name).ToList();
        var mappingDataAllNames = pClone.AddAndMapSharedParams.MappingData
            .SelectMany(m => m.CurrNames)
            .Concat(apsParamNames);
        var internalParams = BuildInternalParams(pClone)
            .Where(internalParam => pClone.AddFamilyParams.Parameters.All(existing =>
                !string.Equals(existing.Name, internalParam.Name, StringComparison.OrdinalIgnoreCase)))
            .ToList();
        pClone.AddFamilyParams.AddParameters(internalParams);
        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(pClone.MakeElectricalConnector);
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            pClone.AddFamilyParams,
            pClone.SetKnownParams,
            apsParamData,
            additionalReferences);
        var apsAndAddedParamNames = apsParamNames
            .Concat(knownParamPlan.ResolvedFamilyParams.Parameters.Select(p => p.Name))
            .ToList();

        return new OperationQueue()
            .Add(new CleanFamilyDocument(pClone.CleanFamilyDocument, mappingDataAllNames))
            .Add(new AddAndMapSharedParams(pClone.AddAndMapSharedParams, apsParamData))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new SetKnownParams(knownParamPlan.ResolvedAssignments, knownParamPlan.Catalog))
            .Add(new MakeElecConnector(pClone.MakeElectricalConnector))
            .Add(new PurgeParams(pClone.CleanFamilyDocument.ResolvedPurgeParamsSettings, apsAndAddedParamNames))
            .Add(new SortParams(pClone.SortParams));
    }

    private static ProfileRemap DeepCloneProfile(ProfileRemap profile) {
        var settings = new JsonSerializerSettings {
            ReferenceLoopHandling = ReferenceLoopHandling.Ignore,
            PreserveReferencesHandling = PreserveReferencesHandling.None,
            MaxDepth = 128
        };
        var json = JsonConvert.SerializeObject(profile, Formatting.None, settings);
        var clone = JsonConvert.DeserializeObject<ProfileRemap>(json, settings);
        return clone ?? throw new InvalidOperationException("Failed to clone ProfileRemap settings.");
    }

    private static List<FamilyParamDefinitionModel> BuildInternalParams(ProfileRemap profile) {
        List<FamilyParamDefinitionModel> paramList = [
            new() {
                Name = "_FOUNDRY LAST PROCESSED AT",
                PropertiesGroup = new ForgeTypeId(""),
                DataType = SpecTypeId.String.Text,
                IsInstance = false
            }
        ];

        if (profile.SetKnownParams.GlobalAssignments.All(existing =>
                !string.Equals(existing.Parameter, "_FOUNDRY LAST PROCESSED AT", StringComparison.OrdinalIgnoreCase))) {
            profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
                Parameter = "_FOUNDRY LAST PROCESSED AT",
                Kind = ParamAssignmentKind.Formula,
                Value = $"\"{DateTime.Now:yyyy_MM_dd HH:mm:ss}\""
            });
        }

        if (!profile.MakeElectricalConnector.Enabled)
            return paramList;

        var voltageName = profile.MakeElectricalConnector.SourceParameterNames.Voltage;
        var numberOfPolesName = profile.MakeElectricalConnector.SourceParameterNames.NumberOfPoles;
        var apparentPowerName = profile.MakeElectricalConnector.SourceParameterNames.ApparentPower;
        var mcaName = profile.MakeElectricalConnector.SourceParameterNames.MinimumCircuitAmpacity;

        if (profile.SetKnownParams.GlobalAssignments.All(existing =>
                !string.Equals(existing.Parameter, numberOfPolesName, StringComparison.OrdinalIgnoreCase))) {
            profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
                Parameter = numberOfPolesName,
                Kind = ParamAssignmentKind.Formula,
                Value = $"if({voltageName} = 120, 1, if({voltageName} = 208, 2, (if({voltageName} = 240, 2, 1))))"
            });
        }

        if (profile.SetKnownParams.GlobalAssignments.All(existing =>
                !string.Equals(existing.Parameter, apparentPowerName, StringComparison.OrdinalIgnoreCase))) {
            profile.SetKnownParams.GlobalAssignments.Add(new GlobalParamAssignment {
                Parameter = apparentPowerName,
                Kind = ParamAssignmentKind.Formula,
                Value = $"{voltageName} * {mcaName} * 0.8 * if({numberOfPolesName} = 3, sqrt(3), 1)"
            });
        }

        if (!KnownParamResolver.IsPeParameterName(numberOfPolesName))
            paramList.Insert(0, new FamilyParamDefinitionModel { Name = numberOfPolesName });

        if (!KnownParamResolver.IsPeParameterName(apparentPowerName))
            paramList.Insert(0, new FamilyParamDefinitionModel { Name = apparentPowerName });

        return paramList;
    }

    internal static string ResolveProfileFilePath(string relativePath, string? subDirectory = null) =>
        ResolveSharedStorage().ResolveDocumentPath(relativePath, ResolveRootKey(subDirectory));

    internal static ProfileRemap ReadProfile(
        string relativePath,
        string? subDirectory = null
    ) => ResolveSharedStorage().ReadRequired<ProfileRemap>(relativePath, ResolveRootKey(subDirectory));

    internal static FFMigratorOpenProfileFileActionResult OpenProfileInDefaultApp(
        string relativePath,
        string? subDirectory = null
    ) {
        try {
            var filePath = ResolveProfileFilePath(relativePath, subDirectory);
            if (!File.Exists(filePath)) {
                return new FFMigratorOpenProfileFileActionResult(
                    false,
                    $"Profile file not found: {Path.GetFileName(filePath)}",
                    filePath,
                    false
                );
            }

            FileUtils.OpenInDefaultApp(filePath);
            return new FFMigratorOpenProfileFileActionResult(true, null, filePath, true);
        } catch (Exception ex) {
            return new FFMigratorOpenProfileFileActionResult(false, ex.Message, null, false);
        }
    }

    private static SharedModuleSettingsStorage ResolveSharedStorage() => SettingsModule.SharedStorage();

    private static string ResolveRootKey(string? subDirectory) =>
        string.IsNullOrWhiteSpace(subDirectory)
            ? SettingsModule.DefaultSubDirectory
            : subDirectory;
}

internal record FFMigratorProcessFamiliesActionResult(
    bool Success,
    string? Error,
    string? OutputFolderPath,
    List<string> ProcessedFamilyNames,
    double TotalMs,
    int FamilyCount
);

internal record FFMigratorPlaceFamiliesActionResult(
    bool Success,
    string? Error,
    List<string> FamilyNames,
    int PlacedCount
);

internal record FFMigratorOpenProfileFileActionResult(
    bool Success,
    string? Error,
    string? FilePath,
    bool Opened
);
