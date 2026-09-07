using Newtonsoft.Json;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;
using Pe.Revit.FamilyFoundry.Operations;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>
///     The one DocOperation: capture current, diff against desired (a full family.json or a patch merged onto the
///     capture), run the lowered inner queue, capture again, and put the residue on the receipt. Build from
///     template, bulk patch and normalize are this op with three inputs. The processor (or the caller's
///     <see cref="FamilyVisit" />) holds the transaction; the inner queue opens none.
/// </summary>
public sealed class ReconcileFamily : DocOperation<DefaultOperationSettings> {
    private readonly FamilyModel? _desired;
    private readonly FamilyPatch? _patch;
    private readonly Func<Document, FamilyModel> _capture;
    private readonly bool _dryRun;
    private readonly string? _expectedPlanHash;
    private FamilyReceipt? _candidateReceipt;
    private readonly Func<Document, FamilySharedParameterSource>? _sharedSource;

    /// <summary>Apply specified state; unmentioned family contents remain unchanged.</summary>
    public ReconcileFamily(FamilyModel desired, bool dryRun = false, Func<Document, FamilyModel>? capture = null) : base(new DefaultOperationSettings()) {
        this._desired = desired;
        this._dryRun = dryRun;
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
    }

    /// <summary>Patch mode: omission = unchanged, null = delete, {} = ensure; `run` rules ride along.</summary>
    public ReconcileFamily(FamilyPatch patch, bool dryRun = false, Func<Document, FamilyModel>? capture = null, string? expectedPlanHash = null,
        Func<Document, FamilySharedParameterSource>? sharedSource = null) : base(new DefaultOperationSettings()) {
        this._patch = patch;
        this._dryRun = dryRun;
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
        this._expectedPlanHash = expectedPlanHash;
        this._sharedSource = sharedSource;
    }

    public override string Description => this._patch is null
        ? $"Reconcile the family to family.json '{this._desired!.Family.Name}'"
        : "Reconcile the family to a patch";

    /// <summary>Set per family by Execute; the processor's context.Tag is internal, so the receipt rides here.</summary>
    public FamilyPlan? LastPlan { get; private set; }
    public FamilyReceipt? LastReceipt { get; private set; }

    internal void Complete(bool committed) {
        this.LastReceipt = this._candidateReceipt is { } receipt ? receipt with {
            Converged = committed && receipt.Converged,
            Outcomes = committed ? receipt.Outcomes : receipt.Outcomes.Select(o => o with { Status = LogStatus.Error, Message = "Family processing did not commit successfully." }).ToList(),
            Residue = committed ? receipt.Residue : this.LastPlan?.Changes ?? receipt.Residue
        } : null;
    }

    internal void Reset() {
        this.LastPlan = null;
        this.LastReceipt = null;
        this._candidateReceipt = null;
    }

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext groupContext) {
        this.Reset();
        var current = this._capture(doc.Document);
        var authoredPatch = this._patch ?? new FamilyPatch { Patch = Newtonsoft.Json.Linq.JObject.Parse(FamilyModelJson.Serialize(this._desired!)) };
        var patch = new FamilyPatch { Select = authoredPatch.Select, Run = authoredPatch.Run, Patch = authoredPatch.ResolveParameterRules(current) };
        using var source = this._sharedSource?.Invoke(doc.Document) ?? new FamilySharedParameterSource(doc.Document);
        FamilyModel? desired;
        {
            var parsed = FamilyReconciler.Desired(current, patch);
            if (parsed.Value is null || parsed.Diagnostics.Count > 0)
                return new OperationLog(this.Name, parsed.Diagnostics.Select(d => new LogEntry(d.Path).Error($"{d.Code}: {d.Message}")).ToList());
            desired = source.Resolve(parsed.Value, patch.Patch);
            desired = FamilyReconciler.ResolveNativeFormulas(desired, doc.Document);
        }

        foreach (var parameter in (authoredPatch.Patch["parameters"] as Newtonsoft.Json.Linq.JObject)?.Properties() ?? [])
            if (parameter.Value is Newtonsoft.Json.Linq.JObject fields && fields["tooltip"] is { Type: not Newtonsoft.Json.Linq.JTokenType.Null } &&
                current.Parameters.TryGetValue(parameter.Name, out var existing) && existing.Shared == true)
                throw new InvalidOperationException($"Explicit tooltip replacement for existing shared parameter '{parameter.Name}' cannot be verified through the Revit read API. Unrequested tooltips are preserved.");
        var unitDiagnostics = FamilyModelUnitValidation.Validate(desired!, patch.Patch, source.GetDefinition);
        if (unitDiagnostics.Count > 0)
            return new OperationLog(this.Name, unitDiagnostics.Select(d => new LogEntry(d.Path).Error($"{d.Code}: {d.Message}")).ToList());
        var plan = FamilyReconciler.Reconcile(desired!, current, UnitResolvers.Revit(doc.Document), this._patch?.Run, source.GetDefinition, patch.Patch, source.ResolvedDefinitions);
        this.LastPlan = plan;
        if (this._expectedPlanHash is { } expected && !string.Equals(expected, plan.PlanHash, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Plan hash drifted: expected {expected}, recomputed {plan.PlanHash}. Plan again.");
        if (plan.Refusals.Count > 0)
            return new OperationLog(this.Name, plan.Refusals.Select(r => new LogEntry(r.Path).Error(r.Message)).ToList());
        if (this._dryRun)
            return new OperationLog(this.Name, plan.Changes.Select(c => new LogEntry($"{c.Section}:{c.Key}").Skip($"dry run: {c.Kind}")).ToList());

        var unverifiable = plan.Changes.Where(c => c.Kind == ChangeKind.Unverifiable).ToList();
        if (unverifiable.Count > 0)
            throw new InvalidOperationException($"Requested changes cannot be verified: {string.Join(", ", unverifiable.Select(c => $"{c.Section}:{c.Key}"))}.");
        var logs = new List<OperationLog>();
        var applyPlan = plan;
        if (plan.Queue.Operations.OfType<NormalizeParamSources>().SingleOrDefault() is { } normalization) {
            logs.Add(normalization.Execute(doc, ctx, groupContext));
            OperationProcessor.ThrowOnErrors(logs);
            current = this._capture(doc.Document);
            var afterMigration = FamilyReconciler.Desired(current, patch);
            if (afterMigration.Value is null || afterMigration.Diagnostics.Count > 0)
                throw new InvalidOperationException(string.Join(Environment.NewLine, afterMigration.Diagnostics.Select(d => d.Message)));
            desired = source.Resolve(afterMigration.Value, patch.Patch);
            desired = FamilyReconciler.ResolveNativeFormulas(desired, doc.Document);
            applyPlan = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Revit(doc.Document), this._patch?.Run, source.GetDefinition);
        }
        if (applyPlan.Refusals.Count > 0 || applyPlan.Changes.Any(c => c.Kind == ChangeKind.Unverifiable))
            throw new InvalidOperationException("Source migration left an unsupported requested change.");
        foreach (var callback in applyPlan.Queue.ToFuncs(optimizeTypeOperations: true, singleTransaction: false)) {
            logs.AddRange(callback(doc, ctx));
            OperationProcessor.ThrowOnErrors(logs);
        }
        doc.Document.Regenerate();
        desired = FamilyReconciler.ResolveNativeFormulas(desired!, doc.Document);
        var observed = this._capture(doc.Document);
        var residue = FamilyReconciler.Diff(desired!, observed, UnitResolvers.Revit(doc.Document));
        var outcomes = plan.Changes.Select(c => new ChangeOutcome(c,
            residue.Any(r => r.Section == c.Section && r.Key == c.Key) ? LogStatus.Error : LogStatus.Success,
            c.Section == "parameters.sources" ? string.Join("; ", logs.SelectMany(l => l.Entries).Select(e => $"{e.Name}: {e.Message}")) : null)).ToList();
        this._candidateReceipt = new FamilyReceipt(ctx.FamilyName, plan.PlanHash, outcomes, plan.RunEffects, residue, current.Unmodeled,
            residue.Count == 0 && logs.All(l => l.PendingCount == 0));
        if (!this._candidateReceipt.Converged)
            throw new InvalidOperationException($"Reconciliation left {residue.Count} differences and {logs.Sum(l => l.PendingCount)} pending entries: {string.Join("; ", residue.Select(r => $"{r.Section}:{r.Key} ({r.Kind}), expected {JsonConvert.SerializeObject(r.After)}, observed {JsonConvert.SerializeObject(r.Before)}"))}. Unmodeled: {JsonConvert.SerializeObject(observed.Unmodeled)}");

        return new OperationLog(this.Name, logs.SelectMany(l => l.Entries).ToList());
    }

}
