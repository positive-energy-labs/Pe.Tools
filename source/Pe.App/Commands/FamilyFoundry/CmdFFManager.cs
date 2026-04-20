using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationGroups;
using Pe.Revit.FamilyFoundry.Operations;
using Pe.Revit.FamilyFoundry.Profiles;
using Pe.Revit.FamilyFoundry.Resolution;
using Pe.Revit.Global;
using Pe.Revit.Global.Revit.Ui;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Modules;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands.FamilyFoundry;
// support add, delete, remap, sort, rename

[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";
    private static readonly SettingsModuleManifest<FFManagerProfile> SettingsModule = FFManagerManifest.Module;

    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSetf
    ) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var window = new FoundryPaletteBuilder<FFManagerProfile>(DisplayName, SettingsModule, doc, uiDoc)
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

    private void HandleApplyProfile(FoundryContext<FFManagerProfile> ctx) {
        if (ctx.PreviewData?.IsValid != true || ctx.SelectedProfile == null) {
            new Ballogger()
                .Add(LogEventLevel.Error, new StackFrame(), "Cannot apply profile - profile has validation errors")
                .Show();
            return;
        }

        // Load profile fresh for execution
        var profile = ctx.Settings.ReadRequired(ctx.SelectedProfile.TextPrimary);

        var runOutput = OutputStorage.ExactDir(ctx.Storage.Output().DirectoryPath);
        var applyResult = ctx.Doc.ApplyFamilyProfile(
            profile,
            ctx.SelectedProfile.TextPrimary,
            ctx.OnFinishSettings,
            runOutput);

        if (!applyResult.Success)
            throw new InvalidOperationException(applyResult.Error ?? "FF Manager processing failed.");

        var balloon = new Ballogger();
        foreach (var logCtx in applyResult.Contexts) {
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
        FFManagerProfile profile,
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
                    Name = "_FOUNDRY LAST PROCESSED AT", DataType = SpecTypeId.String.Text
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
                string.Join(Environment.NewLine,
                    ParamDrivenSolidsDiagnosticFormatter.ToDisplayMessages(compiledSolids.Diagnostics)));
        }

        var additionalReferences = KnownParamPlanBuilder
            .CollectReferencedParameterNames(compiledSolids.RefPlanesAndDims)
            .Concat(KnownParamPlanBuilder.CollectReferencedParameterNames(compiledSolids.Extrusions))
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
                Enabled = compilerMessages.Count > 0, Messages = compilerMessages
            }))
            .Add(new MakeParamDrivenPlanesAndDims(compiledSolids.RefPlanesAndDims))
            .Add(new SetKnownParams(formulaOnlyAssignments, knownParamPlan.Catalog))
            .Add(new MakeConstrainedExtrusions(compiledSolids.Extrusions))
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