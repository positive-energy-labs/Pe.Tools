using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Global.Ui;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;
using System.IO;
using Pe.Shared.HostContracts.Scripting;

namespace Pe.App.Commands.FamilyFoundry;

/// <summary>Single-family lane: reconcile the active family document to a family.json, or build a new family from one.</summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) => this.Run(commandData.Application);

    internal Result Run(UIApplication uiapp) {
        var uiDoc = uiapp.ActiveUIDocument;
        try {
            new FoundryPaletteBuilder(DisplayName, uiDoc.Document, uiDoc)
                .WithAction("Reconcile active family", HandleReconcile, ctx => ctx.Model is not null && ctx.Doc.IsFamilyDocument)
                .WithAction("Build new family from template", HandleBuild, ctx => ctx.Model is not null)
                .WithAction("Dry run (plan only)", HandleDryRun, ctx => ctx.Model is not null && ctx.Doc.IsFamilyDocument)
                .Build()
                .Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    private static void HandleReconcile(FoundryContext ctx) => RunAttempt(ctx, "familyfoundry.reconcile", output => Report(ctx, false, output));

    private static void HandleDryRun(FoundryContext ctx) => RunAttempt(ctx, "familyfoundry.plan", output => Report(ctx, true, output));

    internal static void RunAttempt(FoundryContext ctx, string operation, Action<OutputStorage> action) {
        ctx.SelectedProfile!.BeginAttempt();
        var output = (ctx.SelectedProfile.Prepared?.Output() ?? ctx.Storage.Output()).TimestampedSubDir(Guid.NewGuid().ToString("N"));
        try { action(output); }
        catch (Exception ex) {
            // A failed preparation has no validated snapshot to attribute. Its gate error is still shown.
            _ = ctx.SelectedProfile.AttemptSnapshot?.WriteReceipt(output,
                operation, "Failed", [new ScriptOutputReferenceData("artifact-directory", output.DirectoryPath)], reason: ex.Message);
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
        }
    }

    private static void Report(FoundryContext ctx, bool dryRun, OutputStorage runOutput) {
        var model = ctx.SelectedProfile!.LoadModel();
        var op = new ReconcileFamily(model, dryRun, sharedSource: ctx.SelectedProfile.SharedParameterSource());
        var writer = new ProcessingResultBuilder(runOutput).WithProfile(model, ctx.SelectedProfile.TextPrimary).WithReconcile(op);
        using var processor = new OperationProcessor(ctx.Doc);
        var (contexts, ms) = processor.WithArtifactWriter(writer, ctx.OnFinishSettings.OpenOutputFilesOnCommandFinish)
            .ProcessQueue(new OperationQueue().Add(op), null, runOutput.DirectoryPath, ctx.OnFinishSettings);
        var (logs, error) = contexts.Single().OperationLogs;
        _ = ctx.SelectedProfile.Prepared?.WriteReceipt(runOutput,
            dryRun ? "familyfoundry.plan" : "familyfoundry.reconcile",
            error is null && (logs?.Sum(log => log.ErrorCount) ?? 0) == 0 ? "Succeeded" : "Failed",
            [new ScriptOutputReferenceData("artifact-directory", runOutput.DirectoryPath)],
            Observed(ctx.SelectedProfile, op.ObservedParametersDigest));
        var balloon = new Ballogger();
        if (error is not null) _ = balloon.Add(LogEventLevel.Error, new StackFrame(), error.Message);
        else {
            var plan = op.LastPlan;
            _ = balloon.Add(LogEventLevel.Information, new StackFrame(),
                $"{(dryRun ? "Plan" : "Reconciled")} {ctx.Doc.Title}: {plan?.Changes.Count ?? 0} changes, {logs?.Sum(l => l.ErrorCount) ?? 0} errors, residue {op.LastReceipt?.Residue.Count.ToString() ?? "n/a"}, {ms:F0}ms. Output: {runOutput.DirectoryPath}");
        }
        balloon.Show();
    }

    private static void HandleBuild(FoundryContext ctx) => RunAttempt(ctx, "familyfoundry.build", output => Build(ctx, output));

    private static void Build(FoundryContext ctx, OutputStorage runOutput) {
        var model = ctx.SelectedProfile!.LoadModel();
        var outputPath = Path.Combine(runOutput.DirectoryPath, $"{model.Family.Name}.rfa");
        var (receipt, templatePath, _) = FamilyModelBuild.BuildAndSave(ctx.UiDoc.Application.Application, model, outputPath,
            overwrite: true, sharedSource: ctx.SelectedProfile.SharedParameterSource());
        _ = ctx.SelectedProfile.Prepared?.WriteReceipt(runOutput,
            "familyfoundry.build", receipt.Converged ? "Succeeded" : "Failed",
            [new ScriptOutputReferenceData("file", outputPath)], Observed(ctx.SelectedProfile, receipt.ObservedParametersDigest));
        new Ballogger().Add(LogEventLevel.Information, new StackFrame(),
            $"Built {model.Family.Name} from {Path.GetFileName(templatePath)} → {outputPath}. Converged: {receipt?.Converged}, residue {receipt?.Residue.Count}.").Show();
    }

    private static IEnumerable<ObservedExternalRevisionData> Observed(ProfileListItem item, string? digest) =>
        digest is null || item.Prepared is null ? [] : item.Prepared.ExternalRequirements
            .Where(requirement => requirement.Code == "aps.parameters")
            .Select(requirement => new ObservedExternalRevisionData(requirement.Code, requirement.ResourceId, digest));
}
