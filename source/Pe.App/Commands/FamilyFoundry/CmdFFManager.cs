using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.FamilyFoundry.FamilyFoundryUi;
using Pe.App.Host;
using Pe.App.Pods;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.Global.Ui;
using Pe.Revit.Scripting.Pods;
using Pe.Shared.HostContracts.Operations;
using Pe.Revit;
using Serilog.Events;
using System.Diagnostics;
using System.IO;

namespace Pe.App.Commands.FamilyFoundry;

/// <summary>Single-family lane: apply a family spec to the active family document, or build a new family from a model.</summary>
[Transaction(TransactionMode.Manual)]
public class CmdFFManager : IExternalCommand {
    public const string AddinKey = nameof(CmdFFManager);
    public const string DisplayName = "FF Manager";

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) => this.Run(commandData.Application);

    internal Result Run(UIApplication uiapp) {
        var uiDoc = uiapp.ActiveUIDocument;
        try {
            new FoundryPaletteBuilder(DisplayName, uiDoc.Document, uiDoc)
                .WithAction("Apply to active family", ctx => Guarded(() => Apply(ctx)), ctx => ctx.PreviewData?.IsValid == true && ctx.Doc.IsFamilyDocument)
                .WithAction("Build new family from template", ctx => Guarded(() => Build(ctx)), ctx => ctx.Model is not null)
                .WithAction("Plan only", ctx => Guarded(() => Plan(ctx)), ctx => ctx.PreviewData?.IsValid == true && ctx.Doc.IsFamilyDocument)
                .Build()
                .Show();
            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Cancelled;
        }
    }

    internal static void Guarded(Action action) {
        try { action(); }
        catch (Exception ex) { new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show(); }
    }

    private static void Plan(FoundryContext ctx) {
        var plan = FamilyFoundryBridgeOps.PlanFamilies(ctx.SelectedProfile!.LoadSpec().SpecJson, ctx.Doc).Families.Single();
        new Ballogger().Add(plan.Refusals.Count == 0 ? LogEventLevel.Information : LogEventLevel.Warning, new StackFrame(),
            $"Plan {ctx.Doc.Title}: {plan.Changes.Count} changes, {plan.Refusals.Count} refusals. " +
            string.Join("; ", plan.Refusals.Select(r => $"{r.Path}: {r.Message}").Concat(plan.Changes.Select(c => $"{c.Kind} {c.Section}/{c.Key}")))).Show();
    }

    /// <summary>Plan, then apply exactly that plan: the plan is apply's confirmation, not a stage.</summary>
    private static void Apply(FoundryContext ctx) {
        var (spec, source) = ctx.SelectedProfile!.LoadSpec();
        var plan = FamilyFoundryBridgeOps.PlanFamilies(spec, ctx.Doc).Families.Single();
        if (plan.Refusals.Count > 0) {
            new Ballogger().Add(LogEventLevel.Warning, new StackFrame(),
                $"Refused: {string.Join("; ", plan.Refusals.Select(r => $"{r.Path}: {r.Message}"))}").Show();
            return;
        }
        var result = FamilyFoundryBridgeOps.ApplyWithReceipt("family.apply", spec, source,
            new Dictionary<long, string> { [plan.FamilyId] = plan.PlanHash }, ctx.Doc, null, ctx.OnFinishSettings);
        var receipt = result.Receipts.Single();
        new Ballogger().Add(receipt.Success ? LogEventLevel.Information : LogEventLevel.Error, new StackFrame(),
            $"Applied {ctx.Doc.Title}: {plan.Changes.Count} changes, {receipt.Errors.Count} errors, residue {receipt.Residue.Count}. {receipt.Error}\nReceipt: {result.ReceiptPath}").Show();
    }

    private static void Build(FoundryContext ctx) {
        var (model, _, source) = ctx.SelectedProfile!.Member.Load<Pe.Shared.RevitData.Families.FamilyModel>();
        var podFolder = PodMembers.VerifiedFolder(source);
        var buildDir = Path.Combine(Path.GetTempPath(), "Pe.Tools", "family-build", Guid.NewGuid().ToString("N"));
        var fileName = $"{model.Family.Name}.rfa";
        try {
            var (receipt, templatePath, _) = FamilyModelBuild.BuildAndSave(ctx.UiDoc.Application.Application, model, Path.Combine(buildDir, fileName), overwrite: true);
            var receiptPath = PodRuns.WriteReceipt(podFolder,
                new PodReceipt(source.Pod, source.Path, source.Sha256, "revit.apply.family-model", receipt.PlanHash, receipt.Converged ? "Succeeded" : "Failed", [fileName]),
                [(fileName, File.ReadAllBytes(Path.Combine(buildDir, fileName)))]);
            new Ballogger().Add(LogEventLevel.Information, new StackFrame(),
                $"Built {model.Family.Name} from {Path.GetFileName(templatePath)}. Converged: {receipt.Converged}, residue {receipt.Residue.Count}.\nReceipt: {receiptPath}").Show();
        } finally {
            if (Directory.Exists(buildDir)) Directory.Delete(buildDir, true);
        }
    }
}
