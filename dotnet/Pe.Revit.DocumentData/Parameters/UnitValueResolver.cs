using Pe.Shared.RevitData;

namespace Pe.Revit.DocumentData.Parameters;

/// <summary>
///     Revit says what typed text means. The document's own <see cref="Units" /> parse the text for a
///     spec, and the answer comes back in the unit the surface renders, rendered by Revit. Read-only:
///     no element is touched and no transaction is opened, so it is safe on a live document.
/// </summary>
public static class UnitValueResolver {

    public static UnitValueResolveData Resolve(Document document, UnitValueResolveRequest request) {
        var spec = new ForgeTypeId(request.Spec);
        if (!UnitUtils.IsMeasurableSpec(spec))
            return new UnitValueResolveData(false, null, null, $"'{request.Spec}' is not a measurable spec.");

        ForgeTypeId unit;
        try { unit = ParameterUnitResolver.Resolve(request.Unit, spec); }
        catch (InvalidOperationException exception) { return new UnitValueResolveData(false, null, null, exception.Message); }

        var units = document.GetUnits();
        if (!UnitFormatUtils.TryParse(units, spec, request.Text, out var internalValue, out var message))
            return new UnitValueResolveData(false, null, null,
                string.IsNullOrWhiteSpace(message) ? $"Revit could not read '{request.Text}' as a value for this field." : message);

        // Render in the COLUMN's unit, not the document's: a schedule field may override it. The
        // symbol is dropped because the surface already draws the unit it asked for.
        var options = new FormatValueOptions();
        options.SetFormatOptions(new FormatOptions(unit));
        return new UnitValueResolveData(
            true,
            UnitUtils.ConvertFromInternalUnits(internalValue, unit),
            UnitFormatUtils.Format(units, spec, internalValue, false, options),
            null);
    }
}
