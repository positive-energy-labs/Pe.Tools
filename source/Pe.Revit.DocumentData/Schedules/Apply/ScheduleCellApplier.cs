using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Apply;

public static class ScheduleCellApplier {
    public static ScheduleCellApplyData ApplyReviewedScheduleCells(
        this Document document,
        ScheduleCellApplyRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();
        var edits = request.Edits ?? [];
        if (edits.Count > ParameterValueApplier.MaxEditsPerCall)
            throw new ArgumentException($"Edit count {edits.Count} exceeds the {ParameterValueApplier.MaxEditsPerCall}-cell cap.", nameof(request));
        if (edits.Count == 0)
            return new ScheduleCellApplyData(0, 0, request.DryRun, [], []);

        var schedule = document.GetElement(request.ScheduleId.ToElementId()) as ViewSchedule;
        if (schedule == null || !string.Equals(schedule.UniqueId, request.ScheduleUniqueId, StringComparison.Ordinal))
            throw new ArgumentException("Schedule id and uniqueId must resolve to the same schedule.", nameof(request));

        if (request.DryRun)
            return ApplyCore(document, schedule, request, cancellationToken);

        using var sandbox = DocumentSandbox.BeginCommit(document,
            string.IsNullOrWhiteSpace(request.TransactionName) ? "Pe Apply Reviewed Schedule Cells" : request.TransactionName!);
        var commitFailures = new List<(bool IsError, string Message)>();
        var options = sandbox.Transaction.GetFailureHandlingOptions();
        _ = options.SetFailuresPreprocessor(PeToolsFailureHandling.CreatePreprocessor(commitFailures));
        _ = options.SetForcedModalHandling(false);
        sandbox.Transaction.SetFailureHandlingOptions(options);

        var result = ApplyCore(document, schedule, request, cancellationToken);
        if (result.AppliedParameterWrites > 0)
            sandbox.Complete();
        return result with { Diagnostics = result.Diagnostics.Concat(commitFailures.Select(failure =>
            new RevitDataIssue("ScheduleCellApplyCommitFailure", failure.IsError ? RevitDataIssueSeverity.Error : RevitDataIssueSeverity.Warning,
                failure.Message))).ToList() };
    }

    private static ScheduleCellApplyData ApplyCore(
        Document document,
        ViewSchedule schedule,
        ScheduleCellApplyRequest request,
        CancellationToken cancellationToken
    ) {
        var issues = new List<RevitDataIssue>();
        var projection = ScheduleQueryCollector.CollectRequestedCells(document, schedule,
            request.Edits.Select(edit => (edit.RowNumber, edit.ColumnNumber)).ToList(), issues);
        var current = (projection?.Rows ?? [])
            .SelectMany(row => (row.Bindings ?? []).Select(binding => (row.RowNumber, binding.ColumnNumber, Binding: binding)))
            .ToDictionary(item => (item.RowNumber, item.ColumnNumber), item => item.Binding);

        var states = request.Edits.Select((edit, index) => new CellState(index, edit,
            current.GetValueOrDefault((edit.RowNumber, edit.ColumnNumber)))).ToList();
        foreach (var state in states)
            state.Error = ValidateEvidence(state.Edit.ExpectedBinding, state.Current);

        RejectConflictingAliases(states);

        var leafOwners = new Dictionary<(long ElementId, long ParameterId), List<CellState>>();
        foreach (var state in states.Where(state => state.Error == null)) {
            foreach (var target in state.Current!.Targets) {
                var key = (target.ElementId, target.ParameterId);
                if (leafOwners.TryGetValue(key, out var owners)) {
                    owners.Add(state);
                    continue;
                }
                leafOwners[key] = [state];
            }
        }
        if (leafOwners.Count > ParameterValueApplier.MaxEditsPerCall)
            throw new ArgumentException($"Coalesced native write count {leafOwners.Count} exceeds the {ParameterValueApplier.MaxEditsPerCall}-write cap.", nameof(request));
        var leafEdits = leafOwners.Select(pair => {
            var state = pair.Value[0];
            var target = state.Current!.Targets.Single(item => TargetKey(item) == pair.Key);
            return new ParameterValueEdit(target.ElementId, target.ParameterId, null,
                state.Edit.Value, state.Edit.Unit, state.Edit.RawInternal);
        }).ToList();

        if (!request.DryRun && leafEdits.Count != 0)
            cancellationToken.ThrowIfCancellationRequested();
        var leafResults = ParameterValueApplier.ApplyInCurrentTransaction(document, leafEdits, request.DryRun,
            exactParameterId: true);
        AttachLeafResults(leafOwners, leafEdits, leafResults);

        var results = states.OrderBy(state => state.Index).Select(state => new ScheduleCellEditResult(
            state.Index, state.Edit.RowNumber, state.Edit.ColumnNumber,
            state.Error == null && state.LeafResults.Count != 0 && state.LeafResults.All(result => result.Ok),
            state.Error ?? state.LeafResults.FirstOrDefault(result => !result.Ok)?.Error,
            state.Current, state.LeafResults.OrderBy(result => result.Index).ToList())).ToList();
        var appliedWrites = request.DryRun ? 0 : leafResults.Count(result => result.Ok);
        var appliedCells = request.DryRun ? 0 : results.Count(result => result.Ok);
        return new ScheduleCellApplyData(appliedCells, appliedWrites, request.DryRun, results, issues);
    }

    private static string? ValidateEvidence(ScheduleCellBinding expected, ScheduleCellBinding? current) {
        if (current == null)
            return "Requested schedule cell is unavailable.";
        if (expected.Blocker != ScheduleCellBindingBlocker.None)
            return SameBinding(expected, current)
                ? $"Schedule cell is unavailable for mutation ({current.Blocker})."
                : "Reviewed schedule cell evidence is stale.";
        if (expected.Targets == null || expected.Targets.Count == 0)
            return "Reviewed binding is missing canonical target evidence.";
        if (!SameBinding(expected, current))
            return "Reviewed schedule cell evidence is stale.";
        if (current.Blocker != ScheduleCellBindingBlocker.None || current.Targets.Count == 0)
            return $"Schedule cell is unavailable for mutation ({current.Blocker}).";
        return null;
    }

    private static bool SameBinding(ScheduleCellBinding left, ScheduleCellBinding right) =>
        left.ColumnNumber == right.ColumnNumber && left.ParameterId == right.ParameterId &&
        string.Equals(left.ParameterName, right.ParameterName, StringComparison.Ordinal) &&
        left.StorageType == right.StorageType && left.IsTypeParameter == right.IsTypeParameter &&
        left.IsEditable == right.IsEditable && left.Blocker == right.Blocker &&
        left.HasMixedValues == right.HasMixedValues && string.Equals(left.RawValue, right.RawValue, StringComparison.Ordinal) &&
        left.TargetElementIds.SequenceEqual(right.TargetElementIds) && left.Targets.SequenceEqual(right.Targets);

    private static void RejectConflictingAliases(List<CellState> states) {
        var candidates = states.Where(state => state.Error == null).ToList();
        var remaining = new HashSet<CellState>(candidates);
        while (remaining.Count != 0) {
            var component = new HashSet<CellState> { remaining.First() };
            var targets = component.First().Current!.Targets.Select(TargetKey).ToHashSet();
            bool expanded;
            do {
                expanded = false;
                foreach (var candidate in remaining.Where(candidate => !component.Contains(candidate)).ToList()) {
                    if (!candidate.Current!.Targets.Select(TargetKey).Any(targets.Contains))
                        continue;
                    component.Add(candidate);
                    targets.UnionWith(candidate.Current.Targets.Select(TargetKey));
                    expanded = true;
                }
            } while (expanded);
            remaining.ExceptWith(component);
            if (component.Select(state => (state.Edit.Value, state.Edit.Unit, state.Edit.RawInternal)).Distinct().Count() <= 1)
                continue;
            foreach (var state in component)
                state.Error = "Conflicting reviewed cells alias the same native parameter; no cell in the connected alias group was written.";
        }
    }

    private static (long ElementId, long ParameterId) TargetKey(ScheduleCellBindingTarget target) =>
        (target.ElementId, target.ParameterId);

    private static void AttachLeafResults(
        Dictionary<(long ElementId, long ParameterId), List<CellState>> owners,
        IReadOnlyList<ParameterValueEdit> edits,
        IReadOnlyList<ParameterValueEditResult> results
    ) {
        for (var i = 0; i < edits.Count; i++)
            foreach (var owner in owners[(edits[i].ElementId, edits[i].ParameterId!.Value)])
                owner.LeafResults.Add(results[i]);
    }

    private sealed class CellState(int index, ScheduleCellEdit edit, ScheduleCellBinding? current) {
        public int Index { get; } = index;
        public ScheduleCellEdit Edit { get; } = edit;
        public ScheduleCellBinding? Current { get; } = current;
        public string? Error { get; set; }
        public List<ParameterValueEditResult> LeafResults { get; } = [];
    }
}
