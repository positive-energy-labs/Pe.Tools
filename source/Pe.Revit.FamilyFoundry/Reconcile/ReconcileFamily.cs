using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;

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

    /// <summary>Full mode: the document is the whole truth; anything the family carries and the document does not is deleted.</summary>
    public ReconcileFamily(FamilyModel desired, bool dryRun = false, Func<Document, FamilyModel>? capture = null) : base(new DefaultOperationSettings()) {
        this._desired = desired;
        this._dryRun = dryRun;
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
    }

    /// <summary>Patch mode: omission = unchanged, null = delete, {} = ensure; `run` rules ride along.</summary>
    public ReconcileFamily(FamilyPatch patch, bool dryRun = false, Func<Document, FamilyModel>? capture = null) : base(new DefaultOperationSettings()) {
        this._patch = patch;
        this._dryRun = dryRun;
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
    }

    public override string Description => this._patch is null
        ? $"Reconcile the family to family.json '{this._desired!.Family.Name}'"
        : "Reconcile the family to a patch";

    /// <summary>Set per family by Execute; the processor's context.Tag is internal, so the receipt rides here.</summary>
    public FamilyPlan? LastPlan { get; private set; }
    public FamilyReceipt? LastReceipt { get; private set; }

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext groupContext) {
        var current = this._capture(doc.Document);
        var desired = this._desired;
        if (this._patch is not null) {
            var parsed = FamilyReconciler.Desired(current, this._patch);
            if (parsed.Value is null || parsed.Diagnostics.Count > 0)
                return new OperationLog(this.Name, parsed.Diagnostics.Select(d => new LogEntry(d.Path).Error($"{d.Code}: {d.Message}")).ToList());
            desired = parsed.Value;
        }

        var plan = FamilyReconciler.Reconcile(desired!, current, UnitResolvers.Revit(doc.Document), this._patch?.Run);
        this.LastPlan = plan;
        if (plan.Refusals.Count > 0)
            return new OperationLog(this.Name, plan.Refusals.Select(r => new LogEntry(r.Path).Error(r.Message)).ToList());
        if (this._dryRun)
            return new OperationLog(this.Name, plan.Changes.Select(c => new LogEntry($"{c.Section}:{c.Key}").Skip($"dry run: {c.Kind}")).ToList());

        var unverifiable = plan.Changes.Where(c => c.Kind == ChangeKind.Unverifiable).ToList();
        var logs = plan.Queue.ToFuncs(optimizeTypeOperations: true, singleTransaction: true)
            .SelectMany(f => f(doc, ctx)).ToList();
        doc.Document.Regenerate();
        var residue = FamilyReconciler.Diff(desired!, this._capture(doc.Document), UnitResolvers.Revit(doc.Document));
        var outcomes = plan.Changes.Select(c => new ChangeOutcome(c, c.Kind == ChangeKind.Unverifiable ? LogStatus.Skipped : OutcomeOf(logs, c), null)).ToList();
        this.LastReceipt = new FamilyReceipt(ctx.FamilyName, plan.PlanHash, outcomes, plan.RunEffects, residue, current.Unmodeled,
            residue.Count == 0 && outcomes.All(o => o.Status != LogStatus.Error));

        var entries = logs.SelectMany(l => l.Entries).ToList();
        entries.AddRange(unverifiable.Select(c => new LogEntry($"{c.Section}:{c.Key}").Skip("unverifiable: capture did not read this section")));
        return new OperationLog(this.Name, entries);
    }

    private static LogStatus OutcomeOf(IEnumerable<OperationLog> logs, FamilyChange change) =>
        logs.SelectMany(l => l.Entries)
            .Where(e => e.Name.EndsWith(change.Key, StringComparison.Ordinal))
            .Select(e => e.Status).DefaultIfEmpty(LogStatus.Pending).Max();
}
