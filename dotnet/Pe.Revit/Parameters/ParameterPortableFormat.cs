using System.Globalization;

namespace Pe.Revit.Parameters;

/// <summary>Explicit-unit capture from raw internal doubles; independent of document display options.</summary>
public static class ParameterPortableFormat {
    public static Func<double, string> ForSpec(ForgeTypeId spec) {
        if (spec == SpecTypeId.Number || !UnitUtils.IsMeasurableSpec(spec))
            return value => value.ToString("R", CultureInfo.InvariantCulture);
        if (spec == SpecTypeId.Length) return value => value.ToString("R", CultureInfo.InvariantCulture) + "ft";
        if (spec == SpecTypeId.Angle) return value => UnitUtils.ConvertFromInternalUnits(value, UnitTypeId.Degrees).ToString("R", CultureInfo.InvariantCulture) + "deg";
        var units = new Units(UnitSystem.Metric);
        var unit = units.GetFormatOptions(spec).GetUnitTypeId();
        var symbols = FormatOptions.GetValidSymbols(unit).Where(s => !string.IsNullOrEmpty(s.TypeId))
            .OrderBy(s => s.TypeId, StringComparer.Ordinal).Select(LabelUtils.GetLabelForSymbol).ToList();
        return value => {
            var number = UnitUtils.ConvertFromInternalUnits(value, unit).ToString("R", CultureInfo.InvariantCulture);
            foreach (var symbol in symbols) {
                var text = number + " " + symbol;
                if (UnitFormatUtils.TryParse(units, spec, text, out var parsed) &&
                    Math.Abs(parsed - value) <= Math.Max(1, Math.Abs(value)) * 1e-14) return text;
            }
            throw new InvalidOperationException($"Cannot capture exact explicit-unit value for '{spec.TypeId}': {value:R}.");
        };
    }
}
