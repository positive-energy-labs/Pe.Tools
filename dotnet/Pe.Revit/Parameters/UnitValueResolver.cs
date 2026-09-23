using System.Globalization;
using Pe.Shared.RevitData;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Parameters;

/// <summary>
///     The one text→value parse for a measurable spec; nothing else calls Revit's unit parser (repo guard).
///     A measured value `{ value, unit }` converts through <see cref="ToInternal" />; other text is Revit's own
///     parse under the given <see cref="Units" />, then the constrained portable and legacy explicit-unit literals. <see cref="Resolve" /> is the read-only host answer: no element is
///     touched and no transaction is opened, so it is safe on a live document.
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
        if (!TryParse(units, spec, request.Text, out var internalValue, out var message))
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

    /// <summary>
    ///     A measured value `{ value, unit }` to internal units. A plain invariant number converts directly; any other
    ///     Revit rendering in that unit (`1' - 6"`, fractions) is Revit's parse with the spec formatted in that unit.
    ///     Throws naming the valid units, or saying Revit could not read the value.
    /// </summary>
    public static double ToInternal(string value, string unit, ForgeTypeId spec) {
        var unitTypeId = ParameterUnitResolver.Resolve(unit, spec);
        if (double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var number))
            return UnitUtils.ConvertToInternalUnits(number, unitTypeId);
        var units = new Units(UnitSystem.Imperial);
        units.SetFormatOptions(spec, new FormatOptions(unitTypeId));
        return UnitFormatUtils.TryParse(units, spec, value, out var parsed, out var message)
            ? parsed
            : throw new InvalidOperationException($"Revit could not read '{value}' in {ParameterUnitResolver.GetUnitLabel(unitTypeId)}{(string.IsNullOrWhiteSpace(message) ? "" : $": {message}")}.");
    }

    public static bool TryParse(Units units, ForgeTypeId spec, string text, out double value) =>
        TryParse(units, spec, text, out value, out _);

    public static bool TryParse(Units units, ForgeTypeId spec, string text, out double value, out string? message) {
        if (UnitFormatUtils.TryParse(units, spec, text, out value, out message)) return true;
        if (spec == SpecTypeId.HvacTemperature && text.EndsWith(" F", StringComparison.Ordinal) &&
            double.TryParse(text[..^2], NumberStyles.Float, CultureInfo.InvariantCulture, out var fahrenheit)) {
            value = UnitUtils.ConvertToInternalUnits(fahrenheit, UnitTypeId.Fahrenheit);
            return true;
        }
        if (!PortableScalar.TryParse(text, out var literal)) return false;
        if (spec == SpecTypeId.Length && literal.Kind == PortableScalarKind.Length) {
            value = literal.Feet;
            return true;
        }
        if (spec == SpecTypeId.Angle && literal.Kind == PortableScalarKind.Angle) {
            value = UnitUtils.ConvertToInternalUnits(literal.Value, UnitTypeId.Degrees);
            return true;
        }
        return false;
    }
}
