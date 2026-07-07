namespace Pe.Shared.RevitData;

/// <summary>
///     Bounded project-document parameter mutation contracts. Edits redeem "binding handles"
///     (target element id + parameter id) produced by the schedule cell-binding surface
///     (revit.detail.schedules projection.includeBindings), so ParameterId is the preferred
///     addressing form; ParameterName is a fallback for name-only callers.
/// </summary>
public sealed record ParameterValueApplyRequest(
    IReadOnlyList<ParameterValueEdit> Edits,
    bool DryRun = false,
    string? TransactionName = null
);

public sealed record ParameterValueEdit(
    long ElementId,
    // At least one of ParameterId/ParameterName is required; ParameterId (the binding handle) wins.
    long? ParameterId = null,
    string? ParameterName = null,
    string? Value = null
);

public sealed record ParameterValueApplyData(
    int Applied,
    bool DryRun,
    IReadOnlyList<ParameterValueEditResult> Results
);

public sealed record ParameterValueEditResult(
    int Index,
    bool Ok,
    string? Error = null,
    // Invariant raw value that was (or, for dry runs, would be) written. Doubles are raw internal
    // feet formatted G17; strings are the value as written.
    string? ParsedRaw = null
);
