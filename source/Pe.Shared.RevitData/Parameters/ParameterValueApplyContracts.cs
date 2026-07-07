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
    string? Value = null,
    // Unit for measurable double values — the canonical conversion path (UnitUtils
    // ConvertToInternalUnits, document-independent, exact). Accepts a unit ForgeTypeId
    // ("autodesk.unit.unit:cubicFeetPerMinute-1.0.1"), a UnitTypeId member name
    // ("CubicFeetPerMinute"), a unit label ("Cubic feet per minute"), or a symbol ("CFM"),
    // resolved WITHIN the parameter's spec. Invalid units fail per-edit listing the valid ones.
    string? Unit = null,
    // Explicit escape hatch: Value is a raw internal-units double. Without this (or Unit), bare
    // numerals on measurable double parameters are rejected as ambiguous.
    bool RawInternal = false
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
    string? ParsedRaw = null,
    // Round-trip echo for measurable doubles: the internal value re-formatted with the document's
    // units. Callers should assert this matches intent (ideally on a dry run) before a wet run.
    string? ParsedDisplay = null
);
