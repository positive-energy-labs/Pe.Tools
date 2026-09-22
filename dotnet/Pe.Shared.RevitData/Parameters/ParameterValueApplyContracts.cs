namespace Pe.Shared.RevitData;

/// <summary>
///     Bounded project-document parameter mutation contracts. A wet edit names its exact target (element id +
///     parameter id) and carries the <see cref="ParameterTarget" /> evidence it was reviewed against; a stale or
///     missing Expected refuses. A dry run is the evidence read: it returns Current per edit, and is the only place
///     ParameterName resolves (discovery for callers that do not yet know the parameter id).
/// </summary>
public sealed record ParameterValueApplyRequest(
    IReadOnlyList<ParameterValueEdit> Edits,
    bool DryRun = false,
    string? TransactionName = null
);

public sealed record ParameterValueEdit(
    long ElementId,
    // Wet runs need ParameterId and resolve it exactly. ParameterName resolves only on a dry run.
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
    bool RawInternal = false,
    // Evidence the edit was reviewed against (a dry run's Current). Required on a wet run; compared to a fresh
    // read inside the transaction, and any difference refuses the edit as stale.
    ParameterTarget? Expected = null
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
    string? ParsedDisplay = null,
    // The target's evidence as read before any write: what to send back as Expected.
    ParameterTarget? Current = null,
    // Why the plan refused this edit (ParameterEditPlan); null when it was written or failed at the native write. Error keeps the prose.
    EditRefusalCode? Code = null,
    // For admission-group-refused: the code of the refused member its Error names.
    EditRefusalCode? CauseCode = null
);
