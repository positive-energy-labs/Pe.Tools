using Pe.Revit.Extensions.FamDocument.SetValue.Utils;
using Pe.Revit.Global;

namespace Pe.Revit.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Electrical coercion strategy - any number (text included) into an electrical parameter. A bare number is read in this strategy's
///     explicit unit per spec (volts, amperes, volt-amperes, watts), never the project's display unit; a measured electrical source converts
///     exactly through a unit both specs accept.
/// </summary>
public class CoerceElectrical : ICoercionStrategy {
    private static readonly Dictionary<string, ForgeTypeId> ExplicitUnits = new(StringComparer.Ordinal) {
        [SpecTypeId.ElectricalPotential.TypeId] = UnitTypeId.Volts,
        [SpecTypeId.Current.TypeId] = UnitTypeId.Amperes,
        [SpecTypeId.ApparentPower.TypeId] = UnitTypeId.VoltAmperes,
        [SpecTypeId.Wattage.TypeId] = UnitTypeId.Watts,
        [SpecTypeId.ElectricalPower.TypeId] = UnitTypeId.Watts,
        [SpecTypeId.ElectricalFrequency.TypeId] = UnitTypeId.Hertz
    };

    public bool CanMap(CoercionContext context) {
        var isTargetElectrical = context.TargetDataType?.TypeId.Contains(".electrical:") == true;
        var canExtractDouble = Regexes.TryExtractDouble(context.SourceValue?.ToString() ?? string.Empty, out _);
        return isTargetElectrical && canExtractDouble;
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var target = context.TargetDataType;
        if (!ExplicitUnits.TryGetValue(target.TypeId, out var unit))
            return new ArgumentException($"CoerceElectrical names no unit for {target.TypeId}");
        var currVal = context.SourceValue switch {
            // A measured source of the same dimension converts exactly; its display string may be in any unit.
            double measured when context.SourceDataType is { } from && CoerceByStorageType.SharedUnit(from, target) is not null =>
                this.Bucket(UnitUtils.ConvertFromInternalUnits(measured, unit), context.TargetParam),
            // Text gives its first number ("208/230V" reads 208), read in the explicit unit.
            string text => this.ExtractDouble(text, context.TargetParam),
            // Any other number (Number, Integer, Old_Template VMB Voltage under a non-electrical spec) is taken at face value.
            double raw => raw,
            int rawInt => rawInt,
            _ => throw new ArgumentException($"Unsupported source type {context.SourceDataType?.TypeId ?? "null"} for electrical coercion")
        };

        // Inline the Strict strategy to avoid recursive SetValue call
        context.FamilyManager.Set(context.TargetParam, UnitUtils.ConvertToInternalUnits(currVal, unit));
        return context.TargetParam;
    }

    /// <summary>Parse the number first, then bucket it numerically: "1200" is twelve hundred volts, not a string containing "120".</summary>
    private double ExtractDouble(string sourceValue, FamilyParameter targetParam) => this.Bucket(Regexes.ExtractDouble(sourceValue), targetParam);

    private double Bucket(double value, FamilyParameter targetParam) {
        if (!targetParam.Definition.Name.Contains("Voltage", StringComparison.OrdinalIgnoreCase)) return value;

        // somewhat arbitrary ranges. 240 must account for 230. 120 must account for 110 or 115.
        if (value == 208) return 208;
        if (value is >= 225 and <= 245) return 240;
        if (value is >= 107 and <= 121) return 120;

        return value;
    }
}
