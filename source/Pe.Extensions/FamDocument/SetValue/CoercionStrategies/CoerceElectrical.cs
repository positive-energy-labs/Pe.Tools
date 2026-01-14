using Pe.Extensions.FamDocument.SetValue.Utils;

namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Electrical coercion strategy - converts numeric/string values to electrical parameters with unit conversion.
/// </summary>
public class CoerceElectrical : ICoercionStrategy {
    // Pre-computed voltage ranges for performance
    private static readonly HashSet<double> VoltRange240 = [.. Enumerable.Range(225, 21).Select(x => (double)x)];
    private static readonly HashSet<double> VoltRange120 = [.. Enumerable.Range(107, 15).Select(x => (double)x)];

    public bool CanMap(CoercionContext context) {
        var isTargetElectrical = context.TargetDataType?.TypeId.Contains(".electrical:") == true;
        var canExtractDouble = Regexes.TryExtractDouble(context.SourceValue.ToString(), out _);
        return isTargetElectrical && canExtractDouble;
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var currVal = context.SourceDataType switch {
            var t when t == SpecTypeId.String.Text => this.ExtractDouble(context.SourceValue.ToString() ?? string.Empty,
                context.TargetParam),
            var t when t == SpecTypeId.Number => context.SourceValue as double? ?? 0,
            var t when t == SpecTypeId.Int.Integer => context.SourceValue as int? ?? 0,
            var t when t?.TypeId.Contains(".electrical:") == true => this.ExtractDouble(
                context.SourceValueString ?? context.SourceValue.ToString() ?? string.Empty,
                context.TargetParam),
            _ => throw new ArgumentException(
                $"Unsupported source type {context.SourceDataType?.ToLabel() ?? "null"} for electrical coercion")
        };

        var convertedVal = UnitUtils.ConvertToInternalUnits(currVal, context.TargetUnitType);

        // Inline the Strict strategy to avoid recursive SetValue call
        context.FamilyManager.Set(context.TargetParam, convertedVal);
        return context.TargetParam;
    }

    private double ExtractDouble(string sourceValue, FamilyParameter targetParam) {
        if (!targetParam.Definition.Name.Contains("Voltage", StringComparison.OrdinalIgnoreCase))
            return Regexes.ExtractDouble(sourceValue);

        // somewhat arbitrary ranges. 240 must account for 230. 120 must account for 110 or 115.
        if (sourceValue.Contains(208.ToString())) return 208;
        if (VoltRange240.Any(x => sourceValue.Contains(x.ToString()))) return 240;
        if (VoltRange120.Any(x => sourceValue.Contains(x.ToString()))) return 120;

        return Regexes.ExtractDouble(sourceValue);
    }
}