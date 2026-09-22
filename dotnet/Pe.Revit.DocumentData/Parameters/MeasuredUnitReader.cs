using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>
///     The one reader of measured-cell evidence, for every surface that draws a value a person may
///     retype: whether the value measures anything at all, and the unit THAT document renders it in.
///     Schedules pass the field's effective units (a field format may override the document);
///     a family or families surface passes the units of the document its Reading came from.
/// </summary>
public static class MeasuredUnitReader {

    public static MeasuredDisplayUnit? Read(Units? units, ForgeTypeId? specTypeId) {
        if (specTypeId == null || !Safe(() => (bool?)UnitUtils.IsMeasurableSpec(specTypeId)).GetValueOrDefault())
            return null;
        var options = units == null ? null : Safe(() => units.GetFormatOptions(specTypeId));
        var unit = options == null ? null : Safe(options.GetUnitTypeId);
        if (unit == null || unit.Empty() || unit == UnitTypeId.General)
            return new MeasuredDisplayUnit(specTypeId.TypeId, null, null, null);
        var symbol = options!.CanHaveSymbol() ? Safe(options.GetSymbolTypeId) : null;
        return new MeasuredDisplayUnit(
            specTypeId.TypeId,
            unit.TypeId,
            ScheduleFieldFormatValueDomain.GetUnitLabel(unit),
            symbol == null || symbol.Empty() ? null : ScheduleFieldFormatValueDomain.GetSymbolLabel(symbol));
    }

    /// <summary>The same read from a stored forge id string, which is how family surfaces carry a spec.</summary>
    public static MeasuredDisplayUnit? Read(Units? units, string? specTypeId) =>
        string.IsNullOrWhiteSpace(specTypeId) ? null : Read(units, Safe(() => new ForgeTypeId(specTypeId)));

    private static T? Safe<T>(Func<T> read) {
        try {
            return read();
        } catch {
            return default;
        }
    }
}
