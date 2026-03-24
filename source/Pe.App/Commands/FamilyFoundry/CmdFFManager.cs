using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
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
using Pe.StorageRuntime.Revit.Modules;
using Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.Tools.Commands.FamilyFoundry;
// support add, delete, remap, sort, rename

[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";
    private static readonly CatalogSettingsModule<ProfileFamilyManager> SettingsModule = KnownSettingsRevitModules.FFManager;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<ProfileFamilyManager>(DisplayName, SettingsModule, doc, uiDoc)
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
        var profile = ctx.SharedStorage.ReadRequired<ProfileFamilyManager>(ctx.SelectedProfile.TextPrimary);

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

        var hasProcessedAtParam = profile.AddFamilyParams.Parameters.Any(p =>
            string.Equals(p.Name, "_FOUNDRY LAST PROCESSED AT", StringComparison.OrdinalIgnoreCase));
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

        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(profile.MakeRefPlaneAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(profile.MakeConstrainedExtrusions))
            .ToList();
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profile.AddFamilyParams,
            profile.SetKnownParams,
            apsParamData,
            additionalReferences);

        return new OperationQueue()
            .Add(new AddSharedParams(apsParamData))
            .Add(new AddFamilyParams(knownParamPlan.ResolvedFamilyParams))
            .Add(new MakeRefPlanesAndDims(profile.MakeRefPlaneAndDims))
            .Add(new MakeConstrainedExtrusions(profile.MakeConstrainedExtrusions))
            .Add(new SetKnownParams(knownParamPlan.ResolvedAssignments, knownParamPlan.Catalog, true))
            .Add(new MakeRefPlaneSubcategories(specs))
            .Add(new SortParams(new SortParamsSettings()));
    }
}
