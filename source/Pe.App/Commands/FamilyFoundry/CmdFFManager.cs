using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.FamilyFoundry.Snapshots;
using Pe.Revit.Global;
using Pe.Revit.Global.Revit.Lib;
using Pe.Revit.Global.Revit.Ui;
using Pe.Revit.Global.Utils.Files;
using Pe.Shared.SettingsCatalog;
using Pe.Shared.SettingsCatalog.Manifests;
using Pe.Shared.SettingsCatalog.Manifests.FamilyFoundry;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Tools.Commands.FamilyFoundry.FamilyFoundryUi;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.Tools.Commands.FamilyFoundry;
// support add, delete, remap, sort, rename

[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";
    private static readonly SettingsModuleManifest<FFManagerSettings> SettingsModule = FFManagerManifest.Module;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<FFManagerSettings>(DisplayName, SettingsModule, doc, uiDoc)
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

    private void HandleApplyProfile(FoundryContext<FFManagerSettings> ctx) {
        if (!ctx.PreviewData.IsValid) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot apply profile - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        var profile = ctx.Settings.ReadRequired(ctx.SelectedProfile.TextPrimary);

        // Get raw APS parameter models and convert with fresh TempSharedParamFile
        var apsParamModels = profile.GetFilteredApsParamModels();

        using var tempFile = new TempSharedParamFile(ctx.Doc);
        var apsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
            apsParamModels, tempFile);

        var queue = BuildQueue(profile, apsParamData);
        var processResult = ProcessFamiliesCore(
            ctx.Doc,
            profile,
            ctx.SelectedProfile.TextPrimary,
            ctx.OnFinishSettings,
            ctx.Storage.Output().DirectoryPath);

        if (!processResult.Success) {
            throw new InvalidOperationException(processResult.Error ?? "FF Manager processing failed.");
        }

        var balloon = new Ballogger();
        foreach (var logCtx in processResult.Contexts) {
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"Processed {logCtx.FamilyName} in {logCtx.TotalMs}ms");
        }

        balloon.Show();

        // No post-processing for Manager - it's for family documents only
    }

    public static FFManagerProcessFamiliesActionResult ProcessFamiliesCore(
        Document doc,
        FFManagerSettings profile,
        string profileName,
        LoadAndSaveOptions? onFinishSettings = null,
        string? outputFolderPath = null
    ) {
        if (doc == null) {
            return new FFManagerProcessFamiliesActionResult(
                false,
                "No document provided.",
                [],
                0,
                null);
        }

        OutputStorage? runOutput = null;

        try {
            var apsParamModels = profile.GetFilteredApsParamModels();

            using var tempFile = new TempSharedParamFile(doc);
            var apsParamData = BaseProfileSettings.ConvertToSharedParameterDefinitions(
                apsParamModels,
                tempFile);

            var queue = BuildQueue(profile, apsParamData);
            var finishSettings = onFinishSettings ?? new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = false,
                LoadFamily = false,
                SaveFamilyToInternalPath = false,
                SaveFamilyToOutputDir = false
            };

            var executionOptions = new ExecutionOptions { SingleTransaction = false, OptimizeTypeOperations = false };
            var collectorQueue = new CollectorQueue()
                .Add(new ParamSectionCollector())
                .Add(new LookupTableSectionCollector())
                .Add(new RefPlaneSectionCollector())
                .Add(new ExtrusionSectionCollector());

            if (!string.IsNullOrWhiteSpace(outputFolderPath))
                runOutput = OutputStorage.ExactDir(outputFolderPath);

            using var processor = new OperationProcessor(doc, executionOptions);
            var logs = processor
                .SelectFamilies(() => null)
                .ProcessQueue(queue, collectorQueue, runOutput?.DirectoryPath, finishSettings);

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

            return new FFManagerProcessFamiliesActionResult(
                errors.Count == 0,
                errors.FirstOrDefault()?.Message,
                logs.contexts,
                logs.totalMs,
                runOutput?.DirectoryPath);
        } catch (Exception ex) {
            return new FFManagerProcessFamiliesActionResult(
                false,
                ex.Message,
                [],
                0,
                runOutput?.DirectoryPath);
        }
    }

    /// <summary>
    ///     Builds the operation queue from profile settings and APS parameter data.
    ///     Manager-specific: includes RefPlane operations and subcategories.
    /// </summary>
    private static OperationQueue BuildQueue(
        FFManagerSettings profile,
        List<SharedParameterDefinition> apsParamData
    ) {
        // Hardcoded reference plane subcategory specs
        var specs = new List<RefPlaneSubcategorySpec> {
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

        var compiledSolids = AuthoredParamDrivenSolidsCompiler.Compile(profile.ParamDrivenSolids);
        if (!compiledSolids.CanExecute) {
            throw new InvalidOperationException(
                string.Join(Environment.NewLine, ParamDrivenSolidsDiagnosticFormatter.ToDisplayMessages(compiledSolids.Diagnostics)));
        }

        var additionalReferences = KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.InternalExtrusions))
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Connectors))
            .ToList();
        var knownParamPlan = KnownParamPlanBuilder.Compile(
            profile.AddFamilyParams,
            profile.SetKnownParams,
            apsParamData,
            additionalReferences);

        var compilerMessages = compiledSolids.Diagnostics
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
            .Add(new MakeParamDrivenPlanesAndDims(compiledSolids.RefPlanesAndDims))
            .Add(new SetKnownParams(formulaOnlyAssignments, knownParamPlan.Catalog))
            .Add(new MakeConstrainedExtrusions(compiledSolids.InternalExtrusions))
            .Add(new MakeParamDrivenConnectors(compiledSolids.Connectors))
            .Add(new MakeRefPlaneSubcategories(specs))
            .Add(new SortParams(new SortParamsSettings()));
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
}

public record FFManagerProcessFamiliesActionResult(
    bool Success,
    string? Error,
    List<FamilyProcessingContext> Contexts,
    double TotalMs,
    string? OutputFolderPath
);
