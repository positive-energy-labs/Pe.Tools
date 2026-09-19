using Pe.Revit.Extensions.FamDocument.SetValue.Utils;
using Pe.Revit.Global;

namespace Pe.Revit.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Electrical coercion strategy - converts numeric/string values to electrical parameters with unit conversion.
/// </summary>
public class CoerceElectrical : ICoercionStrategy {
    public bool CanMap(CoercionContext context) {
        var isTargetElectrical = context.TargetDataType?.TypeId.Contains(".electrical:") == true;
        var canExtractDouble = Regexes.TryExtractDouble(context.SourceValue?.ToString() ?? string.Empty, out _);
        return isTargetElectrical && canExtractDouble;
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var currVal = context.SourceDataType switch {
            var t when t == SpecTypeId.String.Text => this.ExtractDouble(
                context.SourceValue?.ToString() ?? string.Empty,
                context.TargetParam),
            var t when t == SpecTypeId.Number => context.SourceValue as double? ?? 0,
            var t when t == SpecTypeId.Int.Integer => context.SourceValue as int? ?? 0,
            var t when t?.TypeId.Contains(".electrical:") == true => this.ExtractDouble(
                context.SourceValueString ?? context.SourceValue?.ToString() ?? string.Empty,
                context.TargetParam),
            // A bare value (the Value registry carries no source data type).
            _ when context.SourceValue is string text => this.ExtractDouble(text, context.TargetParam),
            // Any other numeric storage (Old_Template VMB carries Voltage under a non-electrical spec) is taken at face value.
            _ when context.SourceValue is double raw => raw,
            _ when context.SourceValue is int rawInt => rawInt,
            // ToLabel throws on ids without a label; report the raw id instead.
            _ => throw new ArgumentException(
                $"Unsupported source type {context.SourceDataType?.TypeId ?? "null"} for electrical coercion")
        };

        var convertedVal = UnitUtils.ConvertToInternalUnits(currVal, context.TargetUnitType);

        // Inline the Strict strategy to avoid recursive SetValue call
        context.FamilyManager.Set(context.TargetParam, convertedVal);
        return context.TargetParam;
    }

    /// <summary>Parse the number first, then bucket it numerically: "1200" is twelve hundred volts, not a string containing "120".</summary>
    private double ExtractDouble(string sourceValue, FamilyParameter targetParam) {
        var value = Regexes.ExtractDouble(sourceValue);
        if (!targetParam.Definition.Name.Contains("Voltage", StringComparison.OrdinalIgnoreCase)) return value;

        // somewhat arbitrary ranges. 240 must account for 230. 120 must account for 110 or 115.
        if (value == 208) return 208;
        if (value is >= 225 and <= 245) return 240;
        if (value is >= 107 and <= 121) return 120;

        return value;
    }
}
