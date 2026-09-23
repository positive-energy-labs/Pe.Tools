namespace Pe.Shared.RevitData;

/// <summary>
///     That a surface measures this value, and the unit it renders it in, read from the Reading's own
///     document (a schedule field's effective format options, else that document's units for the
///     spec). Every spelling is one the parameter unit door accepts, so a human surface can stage a
///     bare number with it. Null where nothing is measurable at all; TypeId null where it measures
///     but this document shows no unit — the surface asks for one instead of letting a push refuse a
///     bare number later. Refusal where Revit failed to answer, never read as not-measured. Evidence only: no write path fills a unit from it.
/// </summary>
public record MeasuredDisplayUnit(
    /// <summary>The measurable spec the value belongs to; what a parse must be told.</summary>
    string SpecTypeId,
    string? TypeId,
    string? Label,
    string? Symbol,
    /// <summary>Revit's API failed reading this spec's units: the value measures, and no unit may be assumed.</summary>
    string? Refusal = null
);

/// <summary>
///     Read-only: hand Revit the text a person typed into a measured cell and let Revit say what it
///     means. The document is the op's target; no transaction, nothing written.
/// </summary>
public record UnitValueResolveRequest(
    /// <summary>The measurable spec typeId, from the cell's <see cref="MeasuredDisplayUnit" />.</summary>
    string Spec,
    /// <summary>The unit the surface renders, from the same evidence. Any spelling the unit door takes.</summary>
    string Unit,
    /// <summary>Exactly what the person typed, unit symbol and all.</summary>
    string Text
);

/// <summary>
///     What Revit made of the text. <see cref="Value" /> is converted into the requested display unit
///     and <see cref="Text" /> is Revit's own rendering of it in that unit WITHOUT the symbol, so the
///     surface renders "<c>Text Unit</c>" and stages <c>{ Text, Unit }</c> — one rendering rule, and
///     nothing kept that Revit did not say. A refusal carries Revit's reason and stages nothing.
/// </summary>
public record UnitValueResolveData(
    bool Ok,
    double? Value,
    string? Text,
    string? Refusal
);
