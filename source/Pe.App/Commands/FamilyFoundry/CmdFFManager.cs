using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.FamilyFoundry;
using Pe.FamilyFoundry.OperationGroups;
using Pe.FamilyFoundry.Operations;
using Pe.FamilyFoundry.OperationSettings;
using Pe.FamilyFoundry.Snapshots;
using Pe.Global;
using Pe.Global.Revit.Lib;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Utils.Files;
using Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.Tools.Commands.FamilyFoundry.Modules;
using Serilog;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;

namespace Pe.Tools.Commands.FamilyFoundry;
// support add, delete, remap, sort, rename

[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    private static readonly FFManagerSettingsModule SettingsModule = new();
    private const bool EnableToonIncludes = true;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<ProfileFamilyManager>("FF Manager", SettingsModule, doc, uiDoc)
                .WithToonIncludes(EnableToonIncludes)
                .WithAction("Apply Profile", this.HandleApplyProfile,
                    ctx => ctx.PreviewData?.IsValid == true)
                .WithQueueBuilder(BuildQueue)
                .Build();

            window.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void HandleApplyProfile(FoundryContext<ProfileFamilyManager> ctx) {
        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot apply profile - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        using var toonScope = JsonArrayComposer.EnableToonIncludesScope(EnableToonIncludes);
        var profile = SettingsModule.SettingsDir()
            .JsonByRelativePath<ProfileFamilyManager>(ctx.SelectedProfile.TextPrimary)
            .Read();

        // Get raw APS parameter models and convert with fresh TempSharedParamFile
        var apsParamModels = profile.GetFilteredApsParamModels();

        using var tempFile = new TempSharedParamFile(ctx.Doc);
        var apsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
            apsParamModels, tempFile);

        var queue = BuildQueue(profile, apsParamData);

        var outputFolderPath = ctx.Storage.OutputDir().DirectoryPath;

        // Force this to never be single transaction
        var executionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = false };

        // Request both parameter and ref-plane snapshots
        var collectorQueue = new CollectorQueue()
            .Add(new ParamSectionCollector())
            .Add(new RefPlaneSectionCollector())
            .Add(new ExtrusionSectionCollector());

        using var processor = new OperationProcessor(ctx.Doc, executionOptions);
        var logs = processor
            .SelectFamilies(() => ctx.Doc.IsFamilyDocument ? null : Pickers.GetSelectedFamilies(ctx.UiDoc))
            .ProcessQueue(queue, collectorQueue, outputFolderPath, ctx.OnFinishSettings);

        new ProcessingResultBuilder(ctx.Storage)
            .WithProfile(profile, ctx.SelectedProfile.TextPrimary)
            .WithOperationMetadata(queue)
            .WriteSingleFamilyOutput(logs.contexts[0], ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish);

        var balloon = new Ballogger();
        foreach (var logCtx in logs.contexts) {
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Processed {logCtx.FamilyName} in {logCtx.TotalMs}ms");
        }

        balloon.Show();

        // No post-processing for Manager - it's for family documents only
    }

    /// <summary>
    ///     Builds the operation queue from profile settings and APS parameter data.
    ///     Manager-specific: includes RefPlane operations and subcategories.
    /// </summary>
    private static OperationQueue BuildQueue(
        ProfileFamilyManager profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        // Hardcoded reference plane subcategory specs
        var specs = new List<RefPlaneSubcategorySpec> {
            new() { Strength = RpStrength.NotARef, Name = "NotARef", Color = new Color(211, 211, 211) },
            new() { Strength = RpStrength.WeakRef, Name = "WeakRef", Color = new Color(217, 124, 0) },
            new() { Strength = RpStrength.StrongRef, Name = "StrongRef", Color = new Color(255, 0, 0) },
            new() { Strength = RpStrength.CenterLR, Name = "Center", Color = new Color(115, 0, 253) },
            new() { Strength = RpStrength.CenterFB, Name = "Center", Color = new Color(115, 0, 253) }
        };

        var hasProcessedAtParam = profile.AddAndSetParams.Parameters.Any(p =>
            string.Equals(p.Name, "_FOUNDRY LAST PROCESSED AT", StringComparison.OrdinalIgnoreCase));

        if (!hasProcessedAtParam) {
            profile.AddAndSetParams.AddParameters([
                new ParamSettingModel {
                    Name = "_FOUNDRY LAST PROCESSED AT",
                    DataType = SpecTypeId.String.Text,
                    ValueOrFormula = $"\"{DateTime.Now:yyyy-MM-dd HH:mm:ss}\"",
                    SetAs = ParamSettingMode.Formula                }
            ]);
        }

        // Extract parameters needed for dimension labeling from RefPlane specs
        var dimLabelParamsSettings = ExtractDimLabelParams(profile);

        return new OperationQueue()
            .Add(new AddSharedParams(apsParamData))
            .Add(new AddFamilyParams(dimLabelParamsSettings))  // Create dimension label params FIRST (no values)
            .Add(new MakeRefPlanesAndDims(profile.MakeRefPlaneAndDims))
            .Add(new MakeConstrainedExtrusions(profile.MakeConstrainedExtrusions))
            .Add(new AddAndSetParams(profile.AddAndSetParams, true))
            .Add(new MakeRefPlaneSubcategories(specs))
            .Add(new SortParams(new SortParamsSettings()));
    }

    /// <summary>
    ///     Extracts parameter names from MirrorSpecs and OffsetSpecs and finds their settings
    ///     in AddAndSetParams. These parameters are needed before dimension labeling.
    /// </summary>
    private static AddAndSetParamsSettings ExtractDimLabelParams(ProfileFamilyManager profile) {
        // Collect all parameter names referenced in RefPlane specs
        var paramNames = new List<string>();
        paramNames.AddRange(profile.MakeRefPlaneAndDims.MirrorSpecs
            .Where(s => !string.IsNullOrEmpty(s.Parameter))
            .Select(s => s.Parameter));
        paramNames.AddRange(profile.MakeRefPlaneAndDims.OffsetSpecs
            .Where(s => !string.IsNullOrEmpty(s.Parameter))
            .Select(s => s.Parameter));

        var distinctParamNames = paramNames.Distinct().ToList();

        Log.Debug(
            "[ExtractDimLabelParams] Found {ParamCount} dimension label params: {ParamNames}",
            distinctParamNames.Count,
            string.Join(", ", distinctParamNames));

        // Find the corresponding parameter settings from AddAndSetParams
        var dimLabelParamSettings = profile.AddAndSetParams.Parameters
            .Where(p => distinctParamNames.Contains(p.Name))
            .ToList();

        Log.Debug(
            "[ExtractDimLabelParams] Extracted {SettingCount} param settings for dimension labeling",
            dimLabelParamSettings.Count);

        return new AddAndSetParamsSettings {
            Enabled = dimLabelParamSettings.Count > 0,
            CreateFamParamIfMissing = true,
            OverrideExistingValues = false,  // Don't set values yet, just create params
            Parameters = dimLabelParamSettings
        };
    }
}

public class ProfileFamilyManager : BaseProfileSettings {
    [Description("Settings for making reference planes and dimensions")]
    [Required]
    public MakeRefPlaneAndDimsSettings MakeRefPlaneAndDims { get; init; } = new();

    [Description("Settings for setting parameter values and adding family parameters.")]
    [Required]
    public AddAndSetParamsSettings AddAndSetParams { get; init; } = new();

    [Description("Settings for creating constrained extrusions from canonical reference-plane specs.")]
    [Required]
    public MakeConstrainedExtrusionsSettings MakeConstrainedExtrusions { get; init; } = new();
}