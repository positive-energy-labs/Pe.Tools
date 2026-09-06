using Pe.Shared.RevitData.Families;

namespace Pe.Revit.FamilyFoundry.Reconcile;

/// <summary>
///     Critic F5: `Diff` compares values through units, never through strings. Given the parameter a value
///     belongs to, parse the text to a double in that parameter's unit system. Return false when the text is
///     not numeric for that parameter (Text, Material, ...), and the diff falls back to ordinal.
/// </summary>
public delegate bool UnitResolver(string parameter, string text, out double value);

public static class UnitResolvers {
    /// <summary>
    ///     No Revit: the portable grammar for lengths and angles, plain numbers and Yes/No for the rest.
    ///     `1' - 0"` and `12in` are the same length here; `280 CFM` is not numeric and compares ordinal.
    /// </summary>
    public static bool Portable(string parameter, string text, out double value) {
        if (PortableScalar.TryParse(text, out var s)) {
            value = s.Kind == PortableScalarKind.Length ? s.Feet : s.Value;
            return true;
        }
        var v = PortableValue.Parse(text);
        value = v.Number ?? 0;
        return v.Number.HasValue;
    }

    /// <summary>
    ///     Revit-backed: `UnitFormatUtils.TryParse(units, spec, text)` with the spec of the named parameter in
    ///     the document (GROUNDING gotcha 19). Falls back to <see cref="Portable" /> for a parameter the
    ///     document does not carry yet (an Add).
    /// </summary>
    public static UnitResolver Revit(Document document) {
        var units = document.GetUnits();
        return (string parameter, string text, out double value) => {
            var fp = document.FamilyManager.get_Parameter(parameter);
            if (fp is null) return Portable(parameter, text, out value);
            if (fp.StorageType is StorageType.String or StorageType.ElementId) {
                value = 0;
                return false;
            }
            var spec = fp.Definition.GetDataType();
            if (UnitUtils.IsMeasurableSpec(spec) && UnitFormatUtils.TryParse(units, spec, text, out value)) return true;
            return Portable(parameter, text, out value);
        };
    }
}
