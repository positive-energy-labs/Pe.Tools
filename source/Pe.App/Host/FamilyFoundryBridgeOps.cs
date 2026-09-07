using Autodesk.Revit.DB;
using Newtonsoft.Json;
using Pe.Revit;
using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Apply;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Revit.FamilyFoundry.Reconcile;
using Pe.Revit.Operations;
using Pe.Revit.Ui.Core;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.RevitData.Families;
using Pe.Shared.StorageRuntime;
using System.IO;

namespace Pe.App.Host;

/// <summary>Plan and apply a patch to the current family or loaded families; capture loaded families.</summary>
internal static class FamilyFoundryBridgeOps {
    [Op("familyfoundry.plan", Does = "Diff an inline family patch (`{ select, patch, run }`) against the current family document or each loaded family it selects and return the plan per family with a deterministic hash.", Title = "Plan Family Patch", Finds = ["family-foundry", "familyfoundry", "patch", "plan", "plan-hash", "reconcile"], Cost = OpCost.Expensive)]
    private static Task<FamilyFoundryPlanData> Plan(FamilyFoundryPlanRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => PlanFamilies(request, document.Value), cancellationToken);

    [Op("familyfoundry.apply", Does = "Reconcile the current family document or explicit loaded families to an inline family patch, refusing plan drift, and return a receipt with residue per family.", Title = "Apply Family Patch", Finds = ["family-foundry", "familyfoundry", "patch", "apply", "plan-hash", "receipt", "reconcile"], Intent = OpIntent.Mutate, Cost = OpCost.Mutation)]
    private static Task<FamilyFoundryApplyData> Apply(FamilyFoundryApplyRequest request, RevitDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => ApplyFamilies(request, document.Value), cancellationToken);

    [Op("familyfoundry.project", Does = "Open selected loaded families read-only and capture each as family.json with coverage.", Title = "Capture Loaded Families", Finds = ["family-foundry", "familyfoundry", "capture", "family-json", "project"], Cost = OpCost.Expensive)]
    private static Task<FamilyFoundryProjectData> Project(FamilyFoundryProjectRequest request, ProjectDocument document, CancellationToken cancellationToken) =>
        PaletteThreading.RunRevitAsync(() => ProjectFamilies(request, document.Value), cancellationToken);

    private static FamilyFoundryPlanData PlanFamilies(FamilyFoundryPlanRequest request, Document document) {
        var (patch, diagnostics) = ParsePatch(request.PatchJson);
        if (patch is null) return new FamilyFoundryPlanData([], diagnostics);

        var families = document.IsFamilyDocument
            ? request.FamilyId is null || request.FamilyId == document.OwnerFamily.Id.Value() ? new List<Family> { document.OwnerFamily } : []
            : request.FamilyId is { } id
            ? document.GetElement(id.ToElementId()) is Family f ? [f] : []
            : document.FamiliesMatching(patch.Select);
        if (families.Count == 0)
            return new FamilyFoundryPlanData([], [new FamilyFoundryDiagnostic("FamilyNotFound", "$.familyId", request.FamilyId is { } x ? $"Element id {x} is not a loaded family." : "The patch selects no loaded family.")]);

        return new FamilyFoundryPlanData(families.Select(family => WithFamilyDocument(document, family, famDoc => {
            var current = famDoc.CaptureFamilyModel();
            var desired = FamilyReconciler.Desired(current, patch);
            if (desired.Value is null || desired.Diagnostics.Count > 0)
                return new FamilyFoundryFamilyPlanData(family.Id.Value(), family.Name, string.Empty, [], [], desired.Diagnostics.Select(ToDiagnostic).ToList());
            var plan = FamilyReconciler.Reconcile(desired.Value, current, UnitResolvers.Revit(famDoc), patch.Run);
            return new FamilyFoundryFamilyPlanData(family.Id.Value(), family.Name, plan.PlanHash, plan.Changes.Select(ToChange).ToList(), plan.RunEffects, plan.Refusals.Select(ToDiagnostic).ToList());
        })).ToList(), []);
    }

    private static FamilyFoundryApplyData ApplyFamilies(FamilyFoundryApplyRequest request, Document document) {
        var (patch, diagnostics) = ParsePatch(request.PatchJson);
        if (patch is null) return new FamilyFoundryApplyData([], diagnostics);
        if (request.ExpectedPlanHashes is not { Count: > 0 })
            return new FamilyFoundryApplyData([], [new FamilyFoundryDiagnostic("ExpectedPlanHashesRequired", "$.expectedPlanHashes", "Call familyfoundry.plan first and pass each family's planHash.")]);

        var runOutput = StorageClient.Default.Module(FamilyModelSettingsRegistration.ModuleKey).Output().TimestampedSubDir("host-apply");
        var receipts = new List<FamilyFoundryApplyReceipt>();
        foreach (var (familyId, expectedHash) in request.ExpectedPlanHashes) {
            var family = document.IsFamilyDocument
                ? document.OwnerFamily.Id.Value() == familyId ? document.OwnerFamily : null
                : document.GetElement(familyId.ToElementId()) as Family;
            if (family is null) {
                receipts.Add(Failed(familyId, null, $"Element id {familyId} is not a loaded family."));
                continue;
            }
            try {
                var op = new ReconcileFamily(patch, expectedPlanHash: expectedHash);
                var writer = new ProcessingResultBuilder(runOutput).WithProfile(patch, "inline-patch").WithReconcile(op);
                using var processor = new OperationProcessor(document);
                var (contexts, _) = processor.SelectFamilies(() => [family]).WithArtifactWriter(writer)
                    .ProcessQueue(new OperationQueue().Add(op), null, runOutput.DirectoryPath, new LoadAndSaveOptions { OpenOutputFilesOnCommandFinish = false });
                var context = contexts.Single();
                var (logs, error) = context.OperationLogs;
                var receipt = op.LastReceipt;
                {
                    var errors = logs?.SelectMany(l => l.Entries).Where(e => e.Status == LogStatus.Error).Select(e => $"{e.Name}: {e.Message}").ToList() ?? [];
                    receipts.Add(new FamilyFoundryApplyReceipt(familyId, family.Name, error is null && errors.Count == 0 && receipt?.Converged == true, receipt?.Converged ?? false, error?.Message, receipt?.PlanHash,
                        receipt?.Residue.Select(ToChange).ToList() ?? [], errors, context.Artifacts is { } a ? Path.Combine(runOutput.DirectoryPath, a.FamilyDirectory) : null));
                }
            } catch (Exception exception) {
                receipts.Add(Failed(familyId, family.Name, exception.Message));
            }
        }
        return new FamilyFoundryApplyData(receipts, []);
    }

    private static FamilyFoundryProjectData ProjectFamilies(FamilyFoundryProjectRequest request, Document document) {
        if (request.FamilyIds is not { Count: > 0 })
            return new FamilyFoundryProjectData([], [new FamilyFoundryDiagnostic("FamilyIdsRequired", "$.familyIds", "At least one explicit family id is required.")]);
        return new FamilyFoundryProjectData(request.FamilyIds.Distinct().Select(familyId => {
            if (document.GetElement(familyId.ToElementId()) is not Family family)
                return new FamilyFoundryFamilyModelData(familyId, null, false, null, new Dictionary<string, string>(), 0, $"Element id {familyId} is not a loaded family.");
            try {
                return WithFamilyDocument(document, family, famDoc => {
                    var model = famDoc.CaptureFamilyModel();
                    return new FamilyFoundryFamilyModelData(familyId, family.Name, true, FamilyModelJson.Serialize(model),
                        model.Coverage.ToDictionary(p => p.Key, p => p.Value.ToString()), model.Unmodeled.Count, null);
                });
            } catch (Exception exception) {
                return new FamilyFoundryFamilyModelData(familyId, family.Name, false, null, new Dictionary<string, string>(), 0, exception.Message);
            }
        }).ToList(), []);
    }

    /// <summary>Read-only EditFamily (VERDICTS-R1 §7): reuse an already-open family document, else open and close without saving.</summary>
    private static T WithFamilyDocument<T>(Document project, Family family, Func<Document, T> read) {
        if (project.IsFamilyDocument) return read(project);
        var open = project.Application.FindOpenFamilyDocument(family);
        var famDoc = open ?? project.EditFamily(family);
        try { return read(famDoc); }
        finally { if (open is null) _ = famDoc.Close(false); }
    }

    private static (FamilyPatch? Patch, IReadOnlyList<FamilyFoundryDiagnostic> Diagnostics) ParsePatch(string? json) {
        if (string.IsNullOrWhiteSpace(json))
            return (null, [new FamilyFoundryDiagnostic("PatchJsonRequired", "$.patchJson", "patchJson is required: { select, patch, run }.")]);
        try { return (FamilyPatch.Parse(json!), []); }
        catch (JsonException exception) {
            return (null, [new FamilyFoundryDiagnostic("InvalidPatchJson", "$.patchJson", exception.Message, "The fragment follows the family.json schema; omission = unchanged, null = delete, {} = ensure.")]);
        }
    }

    private static FamilyFoundryChangeData ToChange(FamilyChange c) => new(c.Section, c.Key, c.Kind.ToString(), c.MappedFrom);
    private static FamilyFoundryDiagnostic ToDiagnostic(FamilyModelDiagnostic d) => new(d.Code, d.Path, d.Message);
    private static FamilyFoundryApplyReceipt Failed(long id, string? name, string error) => new(id, name, false, false, error, null, [], [error], null);
}
