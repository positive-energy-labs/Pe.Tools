using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Collect;
using Pe.Revit.Failures;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Apply;

/// <summary>
///     Reviewed schedule cells. This door judges only what a cell is (column, parameter, blockers, mixed values,
///     which targets it fans out to). Each cell's targets then go to <see cref="ParameterValueApplier" /> as one
///     admission group with their reviewed evidence as Expected, which is where target staleness, alias conflicts
///     and coalescing are judged.
/// </summary>
public static class ScheduleCellApplier {
    public static ScheduleCellApplyData ApplyReviewedScheduleCells(
        this Document document,
        ScheduleCellApplyRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();
        var edits = request.Edits ?? [];
        if (edits.Count > ParameterValueApplyBounds.MaxEditsPerCall)
            throw new ArgumentException($"Edit count {edits.Count} exceeds the {ParameterValueApplyBounds.MaxEditsPerCall}-cell cap.", nameof(request));
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

        var cells = request.Edits.Select((edit, index) => {
            var binding = current.GetValueOrDefault((edit.RowNumber, edit.ColumnNumber));
            return (Index: index, Edit: edit, Current: binding, Error: ValidateCell(edit.ExpectedBinding, binding));
        }).ToList();
        var admitted = cells.Where(cell => cell.Error == null).ToList();
        var groups = admitted.Select(cell => (IReadOnlyList<ParameterValueEdit>)cell.Edit.ExpectedBinding.Targets
            .Select(target => new ParameterValueEdit(target.ElementId, target.ParameterId, null,
                cell.Edit.Value, cell.Edit.Unit, cell.Edit.RawInternal, target))
            .ToList()).ToList();

        if (!request.DryRun && groups.Count != 0)
            cancellationToken.ThrowIfCancellationRequested();
        var answers = ParameterValueApplier.ApplyGroups(document, groups, request.DryRun);
        var leavesOf = new IReadOnlyList<ParameterValueEditResult>[cells.Count];
        for (var i = 0; i < admitted.Count; i++)
            leavesOf[admitted[i].Index] = answers[i];

        var results = cells.Select(cell => {
            var leaves = leavesOf[cell.Index] ?? [];
            return new ScheduleCellEditResult(cell.Index, cell.Edit.RowNumber, cell.Edit.ColumnNumber,
                cell.Error == null && leaves.Count != 0 && leaves.All(leaf => leaf.Ok),
                cell.Error ?? leaves.FirstOrDefault(leaf => !leaf.Ok)?.Error,
                cell.Current, leaves);
        }).ToList();
        var appliedWrites = request.DryRun ? 0 : groups.Zip(answers, (edits, leaves) => edits.Zip(leaves, (edit, leaf) => (edit, leaf)))
            .SelectMany(pairs => pairs).Where(pair => pair.leaf.Ok)
            .Select(pair => (pair.edit.ElementId, pair.edit.ParameterId)).Distinct().Count();
        var appliedCells = request.DryRun ? 0 : results.Count(result => result.Ok);
        return new ScheduleCellApplyData(appliedCells, appliedWrites, request.DryRun, results, issues);
    }

    /// <summary>Cell-level evidence only; each target's own evidence is judged by the parameter door.</summary>
    private static string? ValidateCell(ScheduleCellBinding expected, ScheduleCellBinding? current) {
        if (current == null)
            return "Requested schedule cell is unavailable.";
        if (expected.Blocker != ScheduleCellBindingBlocker.None)
            return SameCell(expected, current)
                ? $"Schedule cell is unavailable for mutation ({current.Blocker})."
                : "Reviewed schedule cell evidence is stale.";
        if (expected.Targets == null || expected.Targets.Count == 0)
            return "Reviewed binding is missing canonical target evidence.";
        if (!SameCell(expected, current))
            return "Reviewed schedule cell evidence is stale.";
        if (current.Blocker != ScheduleCellBindingBlocker.None || current.Targets.Count == 0)
            return $"Schedule cell is unavailable for mutation ({current.Blocker}).";
        return null;
    }

    // Targets compare by identity here (the cell still fans out to the same parameters); their values are the
    // parameter door's comparison. RawValue is the first target's value, so it is judged there too.
    private static bool SameCell(ScheduleCellBinding left, ScheduleCellBinding right) =>
        left.ColumnNumber == right.ColumnNumber && left.ParameterId == right.ParameterId &&
        string.Equals(left.ParameterName, right.ParameterName, StringComparison.Ordinal) &&
        left.StorageType == right.StorageType && left.IsTypeParameter == right.IsTypeParameter &&
        left.IsEditable == right.IsEditable && left.Blocker == right.Blocker &&
        left.HasMixedValues == right.HasMixedValues &&
        left.TargetElementIds.SequenceEqual(right.TargetElementIds) &&
        (left.Targets ?? []).Select(Key).SequenceEqual(right.Targets.Select(Key));

    private static (long, long) Key(ParameterTarget target) => (target.ElementId, target.ParameterId);
}
