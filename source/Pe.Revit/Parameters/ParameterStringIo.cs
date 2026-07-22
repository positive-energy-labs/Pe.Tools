using System.Globalization;

namespace Pe.Revit.Parameters;

/// <summary>
///     Storage-type- and datatype-aware string IO for element <see cref="Parameter" />s, the
///     project-document sibling of <c>FamilyDocumentSetValue.ParseStringValue</c>: measurable
///     doubles accept unit-formatted strings ("10'", "120V") via the document's units before
///     falling back to invariant-culture numbers, and reads round-trip invariantly.
/// </summary>
public static class ParameterStringIo {
    /// <summary>
    ///     Parses <paramref name="value" /> per the parameter's StorageType/DataType and sets it.
    ///     Null clears string parameters and is rejected for numeric ones. Requires an open
    ///     transaction; gates writability on <see cref="Parameter.IsReadOnly" /> only.
    /// </summary>
    public static bool TrySetFromString(this Parameter parameter, string? value, out string? error) {
        if (parameter.IsReadOnly) {
            error = $"Parameter '{parameter.Definition.Name}' is read-only.";
            return false;
        }

        try {
            switch (parameter.StorageType) {
                case StorageType.String:
                    error = null;
                    return parameter.Set(value ?? string.Empty);
                case StorageType.Integer when TryParseInt(value, out var intValue):
                    error = null;
                    return parameter.Set(intValue);
                case StorageType.Double when TryParseDouble(parameter, value, out var doubleValue):
                    error = null;
                    return parameter.Set(doubleValue);
                case StorageType.Integer:
                case StorageType.Double:
                    error = $"'{value}' is not a valid {parameter.StorageType} value for '{parameter.Definition.Name}'.";
                    return false;
                default:
                    error = $"StorageType.{parameter.StorageType} is not supported for '{parameter.Definition.Name}'.";
                    return false;
            }
        } catch (Exception ex) {
            error = ex.Message;
            return false;
        }
    }

    /// <summary>
    ///     Reads the parameter's value as an invariant-culture string (raw internal value for
    ///     doubles — no unit conversion). Null when the parameter has no value.
    /// </summary>
    public static string? AsInvariantString(this Parameter parameter) {
        if (!parameter.HasValue)
            return null;

        return parameter.StorageType switch {
            StorageType.String => parameter.AsString(),
            StorageType.Integer => parameter.AsInteger().ToString(CultureInfo.InvariantCulture),
            StorageType.Double => parameter.AsDouble().ToString(CultureInfo.InvariantCulture),
            StorageType.ElementId => parameter.AsElementId().Value().ToString(CultureInfo.InvariantCulture),
            _ => null
        };
    }

    private static bool TryParseInt(string? value, out int result) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static bool TryParseDouble(Parameter parameter, string? value, out double result) {
        result = 0;
        if (string.IsNullOrWhiteSpace(value))
            return false;

        var dataType = parameter.Definition.GetDataType();
        if (UnitUtils.IsMeasurableSpec(dataType) &&
            UnitFormatUtils.TryParse(parameter.Element.Document.GetUnits(), dataType, value, out result))
            return true;

        return double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out result);
    }
}
