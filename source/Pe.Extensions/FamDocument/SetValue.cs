using Pe.Extensions.FamDocument.SetValue;
using System.Diagnostics;
using System.Globalization;
using BCS = Pe.Extensions.FamDocument.SetValue.BuiltInCoercionStrategy;

namespace Pe.Extensions.FamDocument;

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
            return famDoc.UnsetFormula(param);
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
                UnitFormatUtils.TryParse(famDoc.GetUnits(), dataType, input, out var parsed)
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
                UnitFormatUtils.Format(famDoc.GetUnits(), dataType, Convert.ToDouble(value), true),
            StorageType.Double => Convert.ToDouble(value).ToString(CultureInfo.InvariantCulture),
            _ => throw new InvalidOperationException(
                $"ValueToFormulaString not supported for parameter '{param.Definition.Name}' with StorageType.{param.StorageType}")
        };
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
        FamilyParameter sourceParam,
        string strategyName = nameof(BCS.Strict)
    ) {
        var context = CoercionContext.FromParam(famDoc, sourceParam, targetParam);
        if (context.SourceValue == null) return null;

        var strategyInstance = ParamCoercionStrategyRegistry.Get(strategyName);

        // DEBUG: Trace coercion context for troubleshooting
        Console.WriteLine($"[SetValue] Source='{sourceParam.Definition.Name}', " +
                        $"SourceStorageType={context.SourceStorageType}, " +
                        $"SourceDataType={context.SourceDataType?.TypeId ?? "null"}, " +
                        $"SourceValue='{context.SourceValue}' (type={context.SourceValue?.GetType().Name}), " +
                        $"Target='{targetParam.Definition.Name}', " +
                        $"TargetStorageType={context.TargetStorageType}, " +
                        $"TargetDataType={context.TargetDataType?.TypeId ?? "null"}, " +
                        $"Strategy={strategyName}");

        if (!strategyInstance.CanMap(context)) {
            var targetDataType = targetParam.Definition.GetDataType();
            var dataTypeDisplay = targetDataType?.TypeId ?? "Unknown";
            Console.WriteLine($"[SetValue] CanMap returned FALSE for strategy '{strategyName}'");
            // Include detailed context in error message for debugging
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
        object sourceValue,
        string strategyName = nameof(BCS.Strict)
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