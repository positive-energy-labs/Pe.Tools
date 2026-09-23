using Pe.Revit.Parameters;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>
///     The one reader of measured-cell evidence, for every surface that draws a value a person may
///     retype: whether the value measures anything at all, and the unit THAT document renders it in.
///     Schedules pass the field's effective units (a field format may override the document);
///     a family or families surface passes the units of the document its Reading came from.
/// </summary>
public static class MeasuredUnitReader {

    /// <summary>Null only when the value measures nothing; a failed Revit read is a refusal, never not-measured.</summary>
    public static MeasuredDisplayUnit? Read(Units? units, ForgeTypeId? specTypeId) {
        if (specTypeId == null || specTypeId.Empty())
            return null;
        try {
            if (!SpecUtils.IsSpec(specTypeId) || !UnitUtils.IsMeasurableSpec(specTypeId))
                return null;
            var options = units?.GetFormatOptions(specTypeId);
            var unit = options?.GetUnitTypeId();
            if (unit == null || unit.Empty() || unit == UnitTypeId.General)
                return new MeasuredDisplayUnit(specTypeId.TypeId, null, null, null);
            var symbol = options!.CanHaveSymbol() ? options.GetSymbolTypeId() : null;
            return new MeasuredDisplayUnit(
                specTypeId.TypeId,
                unit.TypeId,
                ParameterUnitResolver.GetUnitLabel(unit),
                symbol == null || symbol.Empty() ? null : ParameterUnitResolver.GetSymbolLabel(symbol));
        } catch (Exception exception) {
            return new MeasuredDisplayUnit(specTypeId.TypeId, null, null, null,
                $"Revit could not read the display unit of '{specTypeId.TypeId}': {exception.Message}");
        }
    }

    /// <summary>The same read from a stored forge id string, which is how family surfaces carry a spec.</summary>
    public static MeasuredDisplayUnit? Read(Units? units, string? specTypeId) =>
        string.IsNullOrWhiteSpace(specTypeId) ? null : Read(units, new ForgeTypeId(specTypeId));
}
