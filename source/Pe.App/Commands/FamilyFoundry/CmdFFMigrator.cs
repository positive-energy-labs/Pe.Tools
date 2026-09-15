using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Global;
using Pe.Revit.Global.Lib;
using Pe.Revit.Global.Ui;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Commands.FamilyFoundry;

/// <summary>Bulk lane: reconcile every family a patch selects in the project, through one FamilyVisit per family.</summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFMigrator : IExternalCommand {
    public const string AddinKey = nameof(CmdFFMigrator);
    public const string DisplayName = "FF Migrator";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        try {
            new FoundryPaletteBuilder(DisplayName, uiDoc.Document, uiDoc)
                .WithAction("Open Patch File", ctx => Open(ctx.SelectedProfile!.FilePath), ctx => ctx.SelectedProfile != null)
                .WithAction("Process selected families (dry run)", ctx => Process(ctx, dryRun: true), ctx => ctx.Patch is not null && !ctx.Doc.IsFamilyDocument)
                .WithAction("Process selected families", ctx => Process(ctx, dryRun: false), ctx => ctx.Patch is not null && !ctx.Doc.IsFamilyDocument)
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

    /// <summary>The families come from the palette selection when any are selected, else from the patch's `select`.</summary>
    private static void Process(FoundryContext ctx, bool dryRun) {
        var patch = ctx.Patch!;
        var picked = Pickers.GetSelectedFamilies(ctx.UiDoc);
        var families = picked is { Count: > 0 } ? picked : ctx.Doc.FamiliesMatching(patch.Select);
        if (families.Count == 0) {
            new Ballogger().Add(LogEventLevel.Warning, new StackFrame(), "The patch selects no loaded family.").Show();
            return;
        }

        var op = new ReconcileFamily(patch, dryRun);
        var runOutput = ctx.Storage.Output().TimestampedSubDir();
        var writer = new ProcessingResultBuilder(runOutput).WithProfile(patch, ctx.SelectedProfile!.TextPrimary).WithReconcile(op);
        using var processor = new OperationProcessor(ctx.Doc);
        var (contexts, ms) = processor.SelectFamilies(() => families).WithArtifactWriter(writer)
            .ProcessQueue(new OperationQueue().Add(op), null, runOutput.DirectoryPath, new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish, LoadFamily = !dryRun, SaveFamilyToInternalPath = ctx.OnFinishSettings.SaveFamilyToInternalPath, SaveFamilyToOutputDir = ctx.OnFinishSettings.SaveFamilyToOutputDir });
        writer.WriteMultiFamilySummary(ms, ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish);

        var failed = contexts.Count(c => c.OperationLogs.AsTuple().error is not null);
        new Ballogger().Add(failed == 0 ? LogEventLevel.Information : LogEventLevel.Error, new StackFrame(),
            $"{(dryRun ? "Planned" : "Processed")} {contexts.Count} families in {ms:F0}ms, {failed} failed.\nOutput: {runOutput.DirectoryPath}").Show();
        if (!dryRun && !ctx.Doc.IsFamilyDocument)
            FamilyPlacementHelper.PromptAndPlaceFamilies(ctx.UiDoc.Application, families.Select(f => f.Name).ToList(), DisplayName);
    }
}
