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
using Pe.Global.Services.Storage;
using Pe.Global.Utils.Files;
using Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;
using Serilog.Events;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Diagnostics;
using System.IO;

namespace Pe.Tools.Commands.FamilyFoundry;

[Transaction(TransactionMode.Manual)]
public class CmdFFMigrator : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<ProfileRemap>("FF Migrator", doc, uiDoc)
                .WithAction("Process Families", this.HandleProcessFamilies,
                    ctx => ctx.PreviewData?.IsValid == true)
                .WithAction("Place Families", this.HandlePlaceFamilies,
                    ctx => ctx.SelectedProfile != null)
                .WithAction("Open File", this.HandleOpenFile,
                    ctx => ctx.SelectedProfile != null)
                .WithQueueBuilder(BuildQueue)
                .WithPostProcess((ctx, familyNames) =>
                    FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, familyNames, "FF Migrator"))
                .Build();

            window.Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private void HandlePlaceFamilies(FoundryContext<ProfileRemap> context) {
        var profile = context.SettingsManager.SubDir("profiles", true)
            .Json<ProfileRemap>($"{context.SelectedProfile.TextPrimary}.json")
            .Read();
        var families = profile.GetFamilies(context.Doc);
        FamilyPlacementHelper.PromptAndPlaceFamilies(context.UiDoc.Application, families.Select(f => f.Name).ToList(),
            "FF Migrator");

        new Ballogger()
            .Add(LogEventLevel.Information, new StackFrame(),
                $"Schema regenerated for {context.SelectedProfile.TextPrimary}")
            .Show();
    }

    private void HandleOpenFile(FoundryContext<ProfileRemap> context) {
        if (context.SelectedProfile == null) return;

        var filePath = context.SelectedProfile.FilePath;
        if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) {
            new Ballogger()
                .Add(LogEventLevel.Warning, new StackFrame(), $"Profile file not found: {filePath}")
                .Show();
            return;
        }

        FileUtils.OpenInDefaultApp(filePath);
    }

    private void HandleProcessFamilies(FoundryContext<ProfileRemap> ctx) {
        if (ctx.SelectedProfile == null) return;
        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot process families - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        var profile = ctx.SettingsManager.SubDir("profiles", true)
            .Json<ProfileRemap>($"{ctx.SelectedProfile.TextPrimary}.json")
            .Read();

        // Get raw APS parameter models and convert with fresh TempSharedParamFile
        var apsParamModels = profile.GetFilteredApsParamModels();

        // Create fresh TempSharedParamFile and convert raw APS models to SharedParameterDefinitions.
        // The temp file stays alive for the entire ProcessFamilies operation.
        using var tempFile = new TempSharedParamFile(ctx.Doc);
        var apsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
            apsParamModels, tempFile);

        var queue = BuildQueue(profile, apsParamData);

        var outputFolderPath = ctx.Storage.OutputDir().DirectoryPath;

        // Request both parameter and refplane snapshots
        var collectorQueue = new CollectorQueue()
            .Add(new ParamSectionCollector())
            .Add(new RefPlaneSectionCollector());

        // Setup result builder for incremental writes
        var resultBuilder = new ProcessingResultBuilder(ctx.Storage)
                .WithProfile(profile, ctx.SelectedProfile.TextPrimary)
                .WithOperationMetadata(queue)
            ;
        using var processor = new OperationProcessor(ctx.Doc, profile.ExecutionOptions);
        var logs = processor
            .SelectFamilies(() => {
                var picked = Pickers.GetSelectedFamilies(ctx.UiDoc);
                return picked.Any() ? picked : profile.GetFamilies(ctx.Doc);
            })
            .WithPerFamilyCallback(familyCtx =>
                // Write output for each family as it completes
                resultBuilder.WriteSingleFamilyOutput(familyCtx)
            )
            .ProcessQueue(queue, collectorQueue, outputFolderPath, ctx.OnFinishSettings);

        // Write summary file aggregating all families
        resultBuilder.WriteMultiFamilySummary(logs.totalMs, ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish);

        var balloon = new Ballogger();
        foreach (var logCtx in logs.contexts) {
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Processed {logCtx.FamilyName} in {logCtx.TotalMs}ms");
        }

        balloon.Show();

        // Prompt user to place families in a view for testing
        var processedFamilyNames = logs.contexts
            .Select(c => c.FamilyName)
            .Where(name => !string.IsNullOrEmpty(name) && name != "ERROR")
            .ToList();
        FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, processedFamilyNames, "FF Migrator");

        // TempSharedParamFile is disposed here AFTER ProcessFamilies completes
    }

    private static List<ParamSettingModel> BuildInternalParams(ProfileRemap profile) {
        var voltageName = profile.MakeElectricalConnector.SourceParameterNames.Voltage;
        var numberOfPolesName = profile.MakeElectricalConnector.SourceParameterNames.NumberOfPoles;
        var apparentPowerName = profile.MakeElectricalConnector.SourceParameterNames.ApparentPower;
        var mcaName = profile.MakeElectricalConnector.SourceParameterNames.MinimumCircuitAmpacity;

        return [   new ParamSettingModel {
            Name = numberOfPolesName,
            ValueOrFormula =
                $"if({voltageName} = 120, 1, if({voltageName} = 208, 2, (if({voltageName} = 240, 2, 1))))",
            SetAsFormula = true
        },
        new ParamSettingModel {
            Name = apparentPowerName,
            ValueOrFormula = $"{voltageName} * {mcaName} * 0.8 * if({numberOfPolesName} = 3, sqrt(3), 1)",
            SetAsFormula = true
        },
        new ParamSettingModel {
            Name = "_FOUNDRY LAST PROCESSED AT",
            PropertiesGroup = new ForgeTypeId(""),
            DataType = SpecTypeId.String.Text,
            IsInstance = false,
            ValueOrFormula = $"\"{DateTime.Now:yyyy_MM_dd HH:mm:ss}\"",
            SetAsFormula = true
        }
       ];
    }

    /// <summary>
    ///     Builds the operation queue from profile settings and APS parameter data.
    ///     This is used both for preview (with temp conversions) and execution (with real conversions).
    /// </summary>
    private static OperationQueue BuildQueue(
        ProfileRemap profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        var apsParamNames = apsParamData.Select(p => p.ExternalDefinition.Name).ToList();

        var mappingDataAllNames = profile.AddAndMapSharedParams.MappingData
            .SelectMany(m => m.CurrNames)
            .Concat(apsParamNames);

        var apsAndAddedParamNames = apsParamNames
            .Concat(profile.AddAndSetParams.Parameters.Select(p => p.Name))
            .ToList();


        profile.AddAndSetParams.AddParameters(BuildInternalParams(profile));

        return new OperationQueue()
            .Add(new PurgeNestedFamilies(profile.PurgeNestedFamilies))
            .Add(new PurgeReferencePlanes(profile.PurgeReferencePlanes))
            .Add(new PurgeModelLines(profile.PurgeModelLines))
            .Add(new PurgeParams(profile.PurgeParams, mappingDataAllNames))
            .Add(new AddAndMapSharedParams(profile.AddAndMapSharedParams, apsParamData))
            .Add(new AddAndSetParams(profile.AddAndSetParams))
            .Add(new MakeElecConnector(profile.MakeElectricalConnector))
            .Add(new PurgeParams(profile.PurgeParams, apsAndAddedParamNames))
            .Add(new SortParams(profile.SortParams));
    }
}

public class ProfileRemap : BaseProfileSettings {
    [Description("Settings for deleting unused nested families")]
    [Required]
    public DefaultOperationSettings PurgeNestedFamilies { get; init; } = new();

    [Description("Settings for deleting unused reference planes")]
    [Required]
    public PurgeReferencePlanesSettings PurgeReferencePlanes { get; init; } = new();

    [Description(
        "Settings for deleting model lines. Model lines are typically superfluous. most cannot be seen, and the ones that can be are just visual sugar")]
    [Required]
    public DefaultOperationSettings PurgeModelLines { get; init; } = new();

    [Description("Settings for deleting unused parameters")]
    [Required]
    public PurgeParamsSettings PurgeParams { get; init; } = new();

    [Description("Settings for parameter mapping (add/replace and remap)")]
    [Required]
    public MapParamsSettings AddAndMapSharedParams { get; init; } = new();

    [Description("Settings for setting parameter values and adding family parameters.")]
    [Required]
    public AddAndSetParamsSettings AddAndSetParams { get; init; } = new();

    [Description("Settings for hydrating electrical connectors")]
    [Required]
    public MakeElecConnectorSettings MakeElectricalConnector { get; init; } = new();

    [Description("Settings for sorting parameters within each property group.")]
    [Required]
    public SortParamsSettings SortParams { get; init; } = new();
}