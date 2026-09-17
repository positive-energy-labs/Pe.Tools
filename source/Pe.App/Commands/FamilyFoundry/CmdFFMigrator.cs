using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Host;
using Pe.Revit;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.Global.Lib;
using Pe.Revit.Global.Ui;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Commands.FamilyFoundry;

/// <summary>Bulk lane: plan and apply a family spec to the selected loaded families, or every family the spec selects.</summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFMigrator : IExternalCommand {
    public const string AddinKey = nameof(CmdFFMigrator);
    public const string DisplayName = "FF Migrator";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        try {
            new FoundryPaletteBuilder(DisplayName, uiDoc.Document, uiDoc)
                .WithAction("Open Spec File", ctx => Open(ctx.SelectedProfile!.FilePath), ctx => ctx.SelectedProfile != null)
                .WithAction("Plan selected families", ctx => CmdFFManager.Guarded(() => Process(ctx, apply: false)), ctx => ctx.Patch is not null && !ctx.Doc.IsFamilyDocument)
                .WithAction("Apply to selected families", ctx => CmdFFManager.Guarded(() => Process(ctx, apply: true)), ctx => ctx.Patch is not null && !ctx.Doc.IsFamilyDocument)
                .WithAction("Place Families", ctx => FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, ctx.Doc.FamiliesMatching(ctx.Patch!.Select).Select(f => f.Name).ToList(), DisplayName),
                    ctx => ctx.Patch is not null && !ctx.Doc.IsFamilyDocument)
                .Build()
                .Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private static void Open(string path) {
        var opened = File.Exists(path) && FileUtils.OpenInDefaultApp(path);
        new Ballogger().Add(opened ? LogEventLevel.Information : LogEventLevel.Warning, new StackFrame(), opened ? $"Opened {path}" : $"Could not open {path}").Show();
    }

    /// <summary>The families come from the palette selection when any are selected, else from the spec's `select`. Apply runs exactly the plan's hashes.</summary>
    private static void Process(FoundryContext ctx, bool apply) {
        var (spec, source) = ctx.SelectedProfile!.LoadSpec();
        var picked = Pickers.GetSelectedFamilies(ctx.UiDoc);
        var plans = picked is { Count: > 0 }
            ? picked.SelectMany(family => FamilyFoundryBridgeOps.PlanFamilies(spec, ctx.Doc, family.Id.Value()).Families).ToList()
            : FamilyFoundryBridgeOps.PlanFamilies(spec, ctx.Doc).Families.ToList();
        if (plans.Count == 0) {
            new Ballogger().Add(LogEventLevel.Warning, new StackFrame(), "The spec selects no loaded family.").Show();
            return;
        }
        var refused = plans.Where(plan => plan.Refusals.Count > 0).ToList();
        var ready = plans.Where(plan => plan.Refusals.Count == 0).ToList();
        var refusedText = string.Join("\n", refused.Select(plan => $"  • {plan.FamilyName}: {string.Join("; ", plan.Refusals.Select(r => r.Message))}"));
        if (!apply || ready.Count == 0) {
            new Ballogger().Add(refused.Count == 0 ? LogEventLevel.Information : LogEventLevel.Warning, new StackFrame(),
                $"Planned {plans.Count} families: {ready.Sum(plan => plan.Changes.Count)} changes across {ready.Count} ready, {refused.Count} refused.\n{refusedText}").Show();
            return;
        }

        var result = FamilyFoundryBridgeOps.ApplyWithReceipt("families.apply", spec, source,
            ready.ToDictionary(plan => plan.FamilyId, plan => plan.PlanHash), ctx.Doc, null,
            new LoadAndSaveOptions {
                OpenOutputFilesOnCommandFinish = ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish, LoadFamily = true,
                SaveFamilyToInternalPath = ctx.OnFinishSettings.SaveFamilyToInternalPath, SaveFamilyToOutputDir = ctx.OnFinishSettings.SaveFamilyToOutputDir
            });
        var failed = result.Receipts.Count(receipt => !receipt.Success);
        new Ballogger().Add(failed == 0 && refused.Count == 0 ? LogEventLevel.Information : LogEventLevel.Error, new StackFrame(),
            $"Applied {result.Receipts.Count} families, {failed} failed, {refused.Count} refused at plan.\n{refusedText}\nReceipt: {result.ReceiptPath}").Show();
        FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, result.Receipts.Where(r => r.Success).Select(r => r.FamilyName!).ToList(), DisplayName);
    }
}
