using Autodesk.Revit.DB;
using Newtonsoft.Json;

namespace Pe.FamilyFoundry;

public sealed class LengthDriverSpec {
    public static LengthDriverSpec None { get; } = new();

    public string ParameterName { get; init; } = string.Empty;
    public double? LiteralValue { get; init; }
    public string AuthoredValue { get; init; } = string.Empty;

    [JsonIgnore]
    public bool IsEmpty => string.IsNullOrWhiteSpace(this.ParameterName) && this.LiteralValue == null;

    [JsonIgnore]
    public bool IsParameterDriven => !string.IsNullOrWhiteSpace(this.ParameterName);

    [JsonIgnore]
    public bool IsLiteralDriven => this.LiteralValue != null;

    public static LengthDriverSpec FromParameter(string parameterName, string authoredValue = "") => new() {
        ParameterName = parameterName?.Trim() ?? string.Empty,
        AuthoredValue = string.IsNullOrWhiteSpace(authoredValue) ? parameterName?.Trim() ?? string.Empty : authoredValue.Trim()
    };

    public static LengthDriverSpec FromLiteral(double literalValue, string authoredValue) => new() {
        LiteralValue = literalValue,
        AuthoredValue = authoredValue?.Trim() ?? string.Empty
    };

    public static LengthDriverSpec FromLegacyParameter(string? parameterName) =>
        string.IsNullOrWhiteSpace(parameterName)
            ? None
            : FromParameter(parameterName);
}

internal static class LengthDriverSpecExtensions {
    public static string? TryGetParameterName(this LengthDriverSpec? driver) =>
        driver?.IsParameterDriven == true
            ? driver.ParameterName.Trim()
            : null;

    public static bool TryResolveCurrentValue(this LengthDriverSpec? driver, Document doc, out double value) {
        value = 0.0;
        if (driver == null || driver.IsEmpty)
            return false;

        if (driver.IsLiteralDriven) {
            value = driver.LiteralValue ?? 0.0;
            return true;
        }

        var parameter = doc.FamilyManager.get_Parameter(driver.ParameterName);
        if (parameter == null)
            return false;

        var currentType = doc.FamilyManager.CurrentType;
        if (currentType == null || !currentType.HasValue(parameter))
            return false;

        value = currentType.AsDouble(parameter) ?? 0.0;
        return true;
    }
}
