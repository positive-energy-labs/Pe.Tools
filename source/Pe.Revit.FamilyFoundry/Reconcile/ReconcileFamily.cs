using Newtonsoft.Json;
using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.FamilyFoundry.Capture;
using Pe.Shared.RevitData.Families;
using Pe.Revit.FamilyFoundry.Operations;

using Pe.Revit.Failures;

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
    private readonly ExecutionOptions _executionOptions;
    private readonly string? _expectedPlanHash;
    private FamilyReceipt? _candidateReceipt;
    private readonly Func<Document, FamilySharedParameterSource>? _sharedSource;

    /// <summary>Apply specified state; unmentioned family contents remain unchanged.</summary>
    public ReconcileFamily(FamilyModel desired, bool dryRun = false, Func<Document, FamilyModel>? capture = null,
        Func<Document, FamilySharedParameterSource>? sharedSource = null, ExecutionOptions? executionOptions = null) : base(new DefaultOperationSettings()) {
        this._desired = desired;
        this._dryRun = dryRun;
        this._executionOptions = executionOptions ?? new ExecutionOptions();
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
        this._sharedSource = sharedSource;
    }

    /// <summary>Patch mode: omission = unchanged, null = delete, {} = ensure; `run` rules ride along.</summary>
    public ReconcileFamily(FamilyPatch patch, bool dryRun = false, Func<Document, FamilyModel>? capture = null, string? expectedPlanHash = null,
        Func<Document, FamilySharedParameterSource>? sharedSource = null, ExecutionOptions? executionOptions = null) : base(new DefaultOperationSettings()) {
        this._patch = patch;
        this._dryRun = dryRun;
        this._capture = capture ?? FamilyModelCaptureExtensions.CaptureFamilyModel;
        this._expectedPlanHash = expectedPlanHash;
        this._sharedSource = sharedSource;
        this._executionOptions = executionOptions ?? new ExecutionOptions();
        this.FailurePolicy = new FamilyFailurePolicy(patch.Run?.Failures);
    }

    /// <summary>The patch's `run.failures`, applied by the visit that runs this operation; default rejects.</summary>
    public FamilyFailurePolicy FailurePolicy { get; } = FamilyFailurePolicy.Reject;

    public override string Description => this._patch is null
        ? $"Reconcile the family to family.json '{this._desired!.Family.Name}'"
        : "Reconcile the family to a patch";

    /// <summary>Set per family by Execute; the processor's context.Tag is internal, so the receipt rides here.</summary>
    public FamilyPlan? LastPlan { get; private set; }
    public FamilyReceipt? LastReceipt { get; private set; }
    public string? ObservedParametersDigest { get; private set; }
    public IReadOnlyList<string> ObservedResourceIds { get; private set; } = [];

    internal void Complete(bool committed, IReadOnlyList<(string Edit, bool IsError, string Message)>? diagnostics = null) {
        // Resolutions Revit took under run.failures are geometry the patch never named; they ride the receipt as RunEffects.
        var resolutions = (diagnostics ?? []).Where(d => d.Message.StartsWith(FamilyFailurePolicy.ResolvedPrefix, StringComparison.Ordinal))
            .Select(d => $"{d.Edit}: {d.Message}").ToList();
        this.LastReceipt = this._candidateReceipt is { } receipt ? receipt with {
            RunEffects = resolutions.Count == 0 ? receipt.RunEffects : receipt.RunEffects.Concat(resolutions).ToList(),
            Converged = committed && receipt.Converged,
            Outcomes = committed ? receipt.Outcomes : receipt.Outcomes.Select(o => o with { Status = LogStatus.Error, Message = "Family processing did not commit successfully." }).ToList()
        } : null;
    }

    internal void Reset() {
        this.LastPlan = null;
        this.LastReceipt = null;
        this._candidateReceipt = null;
        this.ObservedParametersDigest = null;
        this.ObservedResourceIds = [];
    }

    public override OperationLog Execute(FamilyDocument doc, FamilyProcessingContext ctx, OperationContext groupContext) {
        this.Reset();
        var formulaCache = new Dictionary<(string Parameter, string Formula), string>();
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
            desired = FamilyReconciler.ResolveNativeFormulas(desired, doc.Document, formulaCache);
        }

        foreach (var parameter in (authoredPatch.Patch["parameters"] as Newtonsoft.Json.Linq.JObject)?.Properties() ?? [])
            if (parameter.Value is Newtonsoft.Json.Linq.JObject fields && fields["tooltip"] is { Type: not Newtonsoft.Json.Linq.JTokenType.Null } tooltip &&
                current.Parameters.TryGetValue(parameter.Name, out var existing) && existing.Shared == true &&
                desired.Parameters.TryGetValue(parameter.Name, out var target) && target.Shared == true &&
                existing.SharedGuid == target.SharedGuid &&
                !string.Equals(existing.Tooltip, (string?)tooltip, StringComparison.Ordinal)) {
                var unreadable = current.Unmodeled.Any(fact => fact.Reason == UnmodeledReason.ParameterMetadataUnreadable &&
                    fact.Path == $"$.parameters.{parameter.Name}.tooltip");
                throw new InvalidOperationException(unreadable
                    ? $"Explicit tooltip for existing shared parameter '{parameter.Name}' cannot be verified because its native tooltip could not be read."
                    : $"Explicit tooltip for existing shared parameter '{parameter.Name}' is '{(string?)tooltip}', but its captured native tooltip is '{existing.Tooltip ?? ""}'. Shared tooltip replacement is unsupported.");
            }
        var unitDiagnostics = FamilyModelUnitValidation.Validate(desired!, patch.Patch, source.GetDefinition);
        if (unitDiagnostics.Count > 0)
            return new OperationLog(this.Name, unitDiagnostics.Select(d => new LogEntry(d.Path).Error($"{d.Code}: {d.Message}")).ToList());
        var plan = FamilyReconciler.Reconcile(desired!, current, UnitResolvers.Revit(doc.Document), this._patch?.Run, source.GetDefinition, patch.Patch, source.ResolvedDefinitions, this._executionOptions);
        this.ObservedParametersDigest = source.ObservedParametersDigest;
        this.ObservedResourceIds = source.ObservedResourceIds.OrderBy(id => id, StringComparer.Ordinal).ToList();
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
            desired = FamilyReconciler.ResolveNativeFormulas(desired, doc.Document, formulaCache);
            applyPlan = FamilyReconciler.Reconcile(desired, current, UnitResolvers.Revit(doc.Document), this._patch?.Run, source.GetDefinition, executionOptions: this._executionOptions);
        }
        if (applyPlan.Refusals.Count > 0 || applyPlan.Changes.Any(c => c.Kind == ChangeKind.Unverifiable))
            throw new InvalidOperationException("Source migration left an unsupported requested change.");
        foreach (var callback in applyPlan.Queue.ToFuncs(this._executionOptions.OptimizeTypeOperations, singleTransaction: false)) {
            logs.AddRange(callback(doc, ctx));
            OperationProcessor.ThrowOnErrors(logs);
        }
        doc.Document.Regenerate();
        desired = FamilyReconciler.ResolveNativeFormulas(desired!, doc.Document, formulaCache);
        var observed = this._capture(doc.Document);
        var connectorRule = this._patch?.Run?.ElectricalConnectorParameters;
        var authoredConnectorAssociations = (this._patch?.Patch["connectors"] as Newtonsoft.Json.Linq.JObject)?.Properties()
            .Any(connector => connector.Value is Newtonsoft.Json.Linq.JObject fields && fields["associate"] is not null) == true;
        if (connectorRule is not null)
            ResolveConnectorIntent(doc, desired!, observed, connectorRule, authoredConnectorAssociations);
        // run.clean is a declared effect: the planes, lines, nested families and their dimensions it purged are not residue.
        var purged = new HashSet<string>(StringComparer.Ordinal);
        if (this._patch?.Run?.Clean is { Enabled: true } clean) {
            if (clean.EnablePurgeReferencePlanes) { purged.Add("refPlanes"); purged.Add("dimensions"); }
            if (clean.EnablePurgeModelLines) purged.Add("refLines");
            if (clean.EnablePurgeNestedFamilies) purged.Add("nested");
        }
        // Connectors and forms name planes by position; a purge renumbers them and the re-read comes back Unverifiable or Recreate.
        var replaned = purged.Contains("refPlanes");
        var residue = FamilyReconciler.Diff(desired!, observed, UnitResolvers.Revit(doc.Document))
            .Where(r => !purged.Contains(r.Section) && !(replaned && r.Section is "connectors" or "forms" && r.Kind is ChangeKind.Unverifiable or ChangeKind.Recreate)).ToList();
        // Score what ran, plus the committed changes source migration absorbed before the replan; residue is the test either way.
        var applied = applyPlan.Changes.Select(c => (c.Section, c.Key)).ToHashSet();
        var scored = applyPlan.Changes.Concat(plan.Changes.Where(c => !applied.Contains((c.Section, c.Key)))).ToList();
        var outcomes = scored.Select(c => new ChangeOutcome(c,
            residue.Any(r => r.Section == c.Section && r.Key == c.Key) ? LogStatus.Error : LogStatus.Success,
            c.Section == "parameters.sources" ? string.Join("; ", logs.SelectMany(l => l.Entries).Select(e => $"{e.Name}: {e.Message}")) : null)).ToList();
        this._candidateReceipt = new FamilyReceipt(ctx.FamilyName, plan.PlanHash, applyPlan.PlanHash, outcomes, plan.RunEffects, residue, observed.Unmodeled,
            residue.Count == 0 && logs.All(l => l.PendingCount == 0), this.ObservedParametersDigest, this.ObservedResourceIds);
        if (!this._candidateReceipt.Converged)
            throw new InvalidOperationException($"Reconciliation left {residue.Count} differences and {logs.Sum(l => l.PendingCount)} pending entries ({string.Join(", ", logs.SelectMany(l => l.Entries).Where(e => e.HasPendingWork).Select(e => e.Name))}): {string.Join("; ", residue.Select(r => $"{r.Section}:{r.Key} ({r.Kind}), expected {JsonConvert.SerializeObject(r.After)}, observed {JsonConvert.SerializeObject(r.Before)}"))}. Unmodeled: {JsonConvert.SerializeObject(observed.Unmodeled)}");

        return new OperationLog(this.Name, logs.SelectMany(l => l.Entries).ToList());
    }

    private static void ResolveConnectorIntent(FamilyDocument document, FamilyModel desired, FamilyModel captured,
        ElectricalConnectorParameterRule rule, bool authoredConnectorAssociations) {
        var mappings = new Dictionary<BuiltInParameter, string> {
            [BuiltInParameter.RBS_ELEC_VOLTAGE] = rule.Voltage,
            [BuiltInParameter.RBS_ELEC_NUMBER_OF_POLES] = rule.NumberOfPoles,
            [BuiltInParameter.RBS_ELEC_APPARENT_LOAD] = rule.ApparentPower
        };
        var native = new FilteredElementCollector(document).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>()
            .Where(connector => connector.IsPowerConnector()).ToList();
        if (native.Count == 0 && !rule.CreateIfAbsent) return; // associate-only rule on a family without an electrical connector
        if (native.Count == 0) throw new InvalidOperationException("Electrical connector normalization left no electrical connector.");
        // The associable slots differ by classification (an unbalanced connector drives phase 1), so intent is per system type, never merged.
        var intended = new Dictionary<ConnectorSystemType, Dictionary<string, string>>();
        foreach (var connector in native) {
            var system = connector.SystemClassification == MEPSystemClassification.PowerUnBalanced
                ? ConnectorSystemType.PowerUnBalanced : ConnectorSystemType.PowerBalanced;
            var slots = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var (targetId, sourceName) in mappings) {
                var source = document.FamilyManager.get_Parameter(sourceName);
                var target = connector.AssociableSlot(targetId);
                if (source is null || target is null || document.FamilyManager.GetAssociatedFamilyParameter(target)?.Id != source.Id)
                    throw new InvalidOperationException($"Electrical connector {connector.Id.Value()} did not retain '{targetId}' association to '{sourceName}'.");
                slots[target.Definition.Name] = $"param:{sourceName}";
            }
            intended[system] = slots;
        }
        // Authored associations still have to survive the ordinary diff, including conflicts with the run rule.
        if (authoredConnectorAssociations) return;
        // Only power connectors can carry these associations; Data, Controls and the rest are electrical but never associated here.
        var expected = desired.Connectors.Where(item => item.Value.Domain == ConnectorDomain.Electrical &&
            item.Value.SystemType is ConnectorSystemType.PowerBalanced or ConnectorSystemType.PowerUnBalanced).ToList();
        foreach (var (key, connector) in expected) {
            if (!intended.TryGetValue(connector.SystemType, out var slots)) continue; // no native connector of this classification to copy intent from
            var serializer = JsonSerializer.Create(FamilyModelJson.Settings);
            var json = Newtonsoft.Json.Linq.JObject.FromObject(connector, serializer);
            var associations = json["associate"] as Newtonsoft.Json.Linq.JObject ?? new Newtonsoft.Json.Linq.JObject();
            foreach (var (target, source) in slots) associations[target] = source;
            json["associate"] = associations;
            desired.Connectors[key] = json.ToObject<FamilyModelConnector>(serializer)!;
        }
        // Native host selection is part of create-if-absent; no other observed geometry becomes expected state.
        var created = captured.Connectors.Where(item => item.Value.Domain == ConnectorDomain.Electrical &&
            item.Value.SystemType is ConnectorSystemType.PowerBalanced or ConnectorSystemType.PowerUnBalanced).ToList();
        if (expected.Count == 0) {
            if (native.Count == 1 && created.Count == 1 &&
                created[0].Value.SystemType == ConnectorSystemType.PowerBalanced &&
                intended.TryGetValue(ConnectorSystemType.PowerBalanced, out var adopted) && ExactAssociations(created[0].Value, adopted))
                desired.Connectors.Add(created[0].Key, created[0].Value);
            else if (rule.CreateIfAbsent && native.Count != 1)
                // The loop above already proved every native power connector carries the rule's associations. One connector the capture
                // cannot express (face-hosted, rung 5b: 7 of 13 families) is the requested result plus an unmodeled fact, not a refusal.
                throw new InvalidOperationException($"Electrical connector normalization left {native.Count} native power connectors; the rule creates one.");
        }
    }

    private static bool ExactAssociations(FamilyModelConnector connector, IReadOnlyDictionary<string, string> intended) =>
        connector.Associate?.Count == intended.Count && intended.All(mapping => connector.Associate.GetValueOrDefault(mapping.Key) == mapping.Value);

}
