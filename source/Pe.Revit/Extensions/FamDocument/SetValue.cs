using Pe.Shared.RevitData.Families;
using Pe.Revit.Extensions.FamDocument.SetValue;
using System.Globalization;
using Pe.Revit.Parameters;

namespace Pe.Revit.Extensions.FamDocument;

public static class FamilyDocumentSetValue {
    /// <summary>
    ///     Sets a parameter's formula, then unsets it. The effect of this is a "set" on the
    ///     parameter for ALL family types at once. Use when: setting this parameter to the same value for every family type
    ///     (Supports strings (with optional units like "10'", "120V"), numbers, and already-parsed values.
    /// </summary>
    /// <remarks>
    ///     If the circumstances permit, this can be used in lue of iterating through every family type, a very expensive
    ///     operation.
    /// </remarks>
    /// <param name="famDoc">The family document</param>
    /// <param name="param">The target parameter</param>
    /// <param name="value">Value to set - can be string (parsed based on parameter type), number, or typed value</param>
    /// <param name="errorMessage">Error message if any, null by default</param>
    /// <returns>True if the value was set successfully</returns>
    /// <exception cref="InvalidOperationException">Thrown if the StorageType is not supported or formula setting fails</exception>
    public static bool TrySetUnsetFormula(this FamilyDocument famDoc,
        FamilyParameter param,
        object value,
        out string? errorMessage) {
        try {
            // Parse string inputs into appropriate types
            if (value is string stringValue) value = ParseStringValue(famDoc, param, stringValue);

            var formula = ValueToFormulaString(famDoc, param, value);
            var success = famDoc.TrySetFormulaFast(param, formula, out errorMessage);
            if (!success) return false;
            return famDoc.TrySetFormulaFast(param, null, out errorMessage);
        } catch (Exception ex) {
            errorMessage = ex.ToStringDemystified();
            return false;
        }
    }

    /// <summary>
    ///     Parses a string into the appropriate type based on parameter's StorageType.
    ///     For measurable specs, tries unit-formatted strings first (e.g., "10'", "120V"), then plain numbers.
    /// </summary>
    private static object ParseStringValue(FamilyDocument famDoc, FamilyParameter param, string input) {
        var dataType = param.Definition.GetDataType();

        return param.StorageType switch {
            StorageType.String => input,
            StorageType.Integer => int.Parse(input, CultureInfo.InvariantCulture),
            StorageType.Double when UnitUtils.IsMeasurableSpec(dataType) =>
                ParameterStringIo.TryParseMeasuredValue(famDoc.GetUnits(), dataType, input, out var parsed)
                    ? parsed
                    : double.Parse(input, CultureInfo.InvariantCulture),
            StorageType.Double => double.Parse(input, CultureInfo.InvariantCulture),
            _ => throw new InvalidOperationException(
                $"ParseStringValue not supported for parameter '{param.Definition.Name}' with StorageType.{param.StorageType}")
        };
    }

    /// <summary>
    ///     Converts a value to a formula string appropriate for the parameter's StorageType and DataType.
    /// </summary>
    private static string ValueToFormulaString(FamilyDocument famDoc, FamilyParameter param, object value) {
        var dataType = param.Definition.GetDataType();

        return param.StorageType switch {
            StorageType.String => $"\"{value}\"",
            StorageType.Integer => Convert.ToInt32(value).ToString(),
            StorageType.Double when UnitUtils.IsMeasurableSpec(dataType) =>
                FormatMeasuredValue(famDoc, dataType, Convert.ToDouble(value)),
            StorageType.Double => Convert.ToDouble(value).ToString(CultureInfo.InvariantCulture),
            _ => throw new InvalidOperationException(
                $"ValueToFormulaString not supported for parameter '{param.Definition.Name}' with StorageType.{param.StorageType}")
        };
    }

    private static string FormatMeasuredValue(FamilyDocument famDoc, ForgeTypeId dataType, double value) {
        if (dataType == SpecTypeId.Number) return value.ToString("R", CultureInfo.InvariantCulture);
        var units = famDoc.GetUnits();
        var unit = units.GetFormatOptions(dataType).GetUnitTypeId();
        if (!FormatOptions.IsValidAccuracy(unit, 1e-12))
            unit = UnitUtils.GetValidUnits(dataType).First(candidate => FormatOptions.IsValidAccuracy(candidate, 1e-12));
        using var format = new FormatOptions(unit) { Accuracy = 1e-12 };
        using var options = new FormatValueOptions { AppendUnitSymbol = true };
        options.SetFormatOptions(format);
        var formula = UnitFormatUtils.Format(units, dataType, value, true, options);
        // Display precision can turn 0 K into -0.183333 K. Refuse lossy literals so callers can use per-type Set.
        if (!UnitFormatUtils.TryParse(units, dataType, formula, out var parsed) || Math.Abs(parsed - value) > 1e-9)
            throw new InvalidOperationException($"Cannot represent {value:R} accurately as a formula literal for {dataType.TypeId}.");
        return formula;
    }

    public static IReadOnlyDictionary<string, string> DescribeSetValue(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        FamilyParameter sourceParam,
        string strategyName = nameof(MappingStrategy.Strict)
    ) {
        var context = CoercionContext.FromParam(famDoc, sourceParam, targetParam);
        var strategyInstance = ParamCoercionStrategyRegistry.Get(strategyName);
        return DescribeContext(context, strategyName, strategyInstance.CanMap(context));
    }

    public static IReadOnlyDictionary<string, string> DescribeSetValue(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        object? sourceValue,
        string strategyName = nameof(MappingStrategy.Strict)
    ) {
        var context = CoercionContext.FromValue(famDoc, sourceValue, targetParam);
        var strategyInstance = ValueCoercionStrategyRegistry.Get(strategyName);
        return DescribeContext(context, strategyName, strategyInstance.CanMap(context));
    }

    private static Dictionary<string, string> DescribeContext(
        CoercionContext context,
        string strategyName,
        bool canMap
    ) => new() {
        ["MappingStrategy"] = strategyName,
        ["CanMap"] = canMap.ToString(),
        ["SourceStorageType"] = context.SourceStorageType.ToString(),
        ["SourceDataType"] = context.SourceDataType?.TypeId ?? string.Empty,
        ["SourceValue"] = context.SourceValue?.ToString() ?? string.Empty,
        ["SourceValueType"] = context.SourceValue?.GetType().Name ?? string.Empty,
        ["SourceValueString"] = context.SourceValueString ?? string.Empty,
        ["TargetStorageType"] = context.TargetStorageType.ToString(),
        ["TargetDataType"] = context.TargetDataType.TypeId,
        ["TargetUnitType"] = context.TargetUnitType?.TypeId ?? string.Empty
    };

    /// <summary>
    ///     Set a family's parameter value on the <c>FamilyManager.CurrentType</c> using the specified strategy name.
    ///     If no strategy is specified, uses the <c>Strict</c> strategy.
    /// </summary>
    /// <remarks>
    ///     YOU MUST set FamilyManager.CurrentType BEFORE using this method. Both getting and setting CurrentType
    ///     are VERY expensive operations, thus it is not done inside this method. Do it at the highest-level possible
    ///     in your loop/s.
    /// </remarks>
    /// <returns>
    ///     The mapped (target) parameter, or null if the source value is null.
    /// </returns>
    public static FamilyParameter? SetValue(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        FamilyParameter sourceParam,
        string strategyName = nameof(MappingStrategy.Strict)
    ) {
        var context = CoercionContext.FromParam(famDoc, sourceParam, targetParam);
        if (context.SourceValue == null) return null;

        var strategyInstance = ParamCoercionStrategyRegistry.Get(strategyName);


        if (!strategyInstance.CanMap(context)) {
            var targetDataType = targetParam.Definition.GetDataType();
            var dataTypeDisplay = targetDataType?.TypeId ?? "Unknown";
            throw new Exception(
                $"Cannot map '{sourceParam.Definition.Name}' to '{targetParam.Definition.Name}' ({dataTypeDisplay}) using strategy '{strategyName}'. " +
                $"SourceStorageType={context.SourceStorageType}, SourceDataType={context.SourceDataType?.TypeId ?? "null"}, " +
                $"SourceValue='{context.SourceValue}' (type={context.SourceValue?.GetType().Name ?? "null"})");
        }

        var (param, err) = strategyInstance.Map(context);
        if (err is not null) throw err;
        return param;
    }

    /// <summary>
    ///     Set a family's parameter value on the <c>FamilyManager.CurrentType</c> using the specified strategy name.
    ///     If no strategy is specified, uses the <c>Strict</c> strategy.
    /// </summary>
    /// <remarks>
    ///     YOU MUST set FamilyManager.CurrentType BEFORE using this method. Both getting and setting CurrentType
    ///     are VERY expensive operations, thus it is not done inside this method. Do it at the highest-level possible
    ///     in your loop/s.
    /// </remarks>
    /// <returns>
    ///     The mapped (target) parameter, or null if the source value is null.
    /// </returns>
    public static FamilyParameter? SetValue(
        this FamilyDocument famDoc,
        FamilyParameter targetParam,
        object? sourceValue,
        string strategyName = nameof(MappingStrategy.Strict)
    ) {
        var context = CoercionContext.FromValue(famDoc, sourceValue, targetParam);
        if (context.SourceValue == null) return null;

        var strategyInstance = ValueCoercionStrategyRegistry.Get(strategyName);

        if (!strategyInstance.CanMap(context)) {
            var targetDataType = targetParam.Definition.GetDataType();
            var dataTypeDisplay = targetDataType?.TypeId ?? "Unknown";
            throw new Exception(
                $"Cannot map value '{sourceValue}' to '{targetParam.Definition.Name}' ({dataTypeDisplay}) using strategy '{strategyName}'");
        }

        var (param, err) = strategyInstance.Map(context);
        if (err is not null) throw err;
        return param;
    }
}
