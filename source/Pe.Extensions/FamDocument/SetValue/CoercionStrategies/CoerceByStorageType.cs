using Pe.Extensions.FamDocument.SetValue.Utils;
using System.Diagnostics;

namespace Pe.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Storage type coercion strategy - handles cases where storage types differ but data types are compatible.
///     Implements comprehensive storage type conversions based on Revit's parameter system.
/// </summary>
public class CoerceByStorageType : ICoercionStrategy {
    public bool CanMap(CoercionContext context) {
        // DEBUG: Log storage types for troubleshooting
        Debug.WriteLine($"[CoerceByStorageType.CanMap] " +
                        $"SourceStorageType={context.SourceStorageType}, " +
                        $"TargetStorageType={context.TargetStorageType}");

        // Same storage type - always compatible
        if (context.SourceStorageType == context.TargetStorageType) {
            Debug.WriteLine("[CoerceByStorageType.CanMap] Same storage type - returning true");
            return true;
        }

        // Check cross-storage-type conversions      
        var result = (context.SourceStorageType, context.TargetStorageType) switch {
            (StorageType.Integer, StorageType.String) => true,
            (StorageType.Integer, StorageType.Double) => true,
            (StorageType.Double, StorageType.String) => true,
            (StorageType.Double, StorageType.Integer) => true,
            (StorageType.String, StorageType.Integer) => Regexes.TryExtractInteger(
                context.SourceValue.ToString(), out _),
            (StorageType.String, StorageType.Double) => CanParseStringToDouble(context),
            _ => false
        };

        Debug.WriteLine($"[CoerceByStorageType.CanMap] Pattern match result={result}");
        return result;
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var convertedValue = (context.SourceStorageType, context.TargetStorageType) switch {
            // Same type - no conversion needed
            _ when context.SourceStorageType == context.TargetStorageType => context.SourceValue,

            // There is only one relevant SpecTypeId that stores as an integer: SpecTypeId.Int.Integer. 
            // Int.NumberOfPoles & Boolean.YesNo do too, but we can assume 
            // 1) that the user will not attempt this conversion and 2) that these are already "properly" set.
            (StorageType.Integer, StorageType.Double) => UnitUtils.ConvertToInternalUnits(
                context.SourceValue as int? ?? 0, context.TargetUnitType),

            // Safe to simply .ToString() on the integerParam's value
            (StorageType.Integer, StorageType.String) => context.SourceValue.ToString(),

            // Try to use the SourceValueString if it is available, otherwise fall back to ToString()
            (StorageType.Double, StorageType.String) => context.SourceValueString ?? context.SourceValue.ToString(),

            // Set to integer by extracting integer from the doubleParam's "value string"
            (StorageType.Double, StorageType.Integer) =>
                Regexes.ExtractInteger(context.SourceValueString ?? string.Empty),

            // Set to integer by extracting integer from the stringParam's value
            (StorageType.String, StorageType.Integer) =>
                Regexes.ExtractInteger(context.SourceValue.ToString() ?? string.Empty),

            // Set to double by parsing string - uses Revit's parser for measurable specs (imperial notation)
            (StorageType.String, StorageType.Double) =>
                ParseStringToDouble(context),

            _ => throw new ArgumentException(
                $"Unsupported storage type conversion from {context.SourceStorageType} to {context.TargetStorageType}")
        };

        // Inline the Strict strategy to avoid recursive SetValue call
        var fm = context.FamilyManager;
        var target = context.TargetParam;

        switch (convertedValue) {
        case double doubleValue:
            fm.Set(target, doubleValue);
            return target;
        case int intValue:
            fm.Set(target, intValue);
            return target;
        case string stringValue:
            fm.Set(target, stringValue);
            return target;
        case ElementId elementIdValue:
            fm.Set(target, elementIdValue);
            return target;
        default:
            return new ArgumentException($"Invalid type of value to set ({convertedValue?.GetType().Name ?? "null"})");
        }
    }

    /// <summary>
    ///     Checks if a string value can be parsed to double for the target parameter.
    ///     Uses Revit's UnitFormatUtils for measurable specs (handles imperial notation like "0' - 1/2\""),
    ///     falls back to regex extraction for plain numbers.
    /// </summary>
    private static bool CanParseStringToDouble(CoercionContext context) {
        var stringValue = context.SourceValue?.ToString();

        // DEBUG: Log the actual values for troubleshooting
        var isMeasurable = context.TargetDataType != null && UnitUtils.IsMeasurableSpec(context.TargetDataType);
        var regexResult = Regexes.TryExtractDouble(stringValue, out var extractedValue) &&
                          !string.IsNullOrWhiteSpace(stringValue);
        Debug.WriteLine($"[CoerceByStorageType.CanParseStringToDouble] " +
                        $"stringValue='{stringValue}', " +
                        $"isNullOrWhitespace={string.IsNullOrWhiteSpace(stringValue)}, " +
                        $"targetDataType={context.TargetDataType?.TypeId ?? "null"}, " +
                        $"isMeasurableSpec={isMeasurable}, " +
                        $"regexCanExtract={regexResult}" +
                        (regexResult ? $", extractedValue={extractedValue}" : ""));

        if (string.IsNullOrWhiteSpace(stringValue)) return false;

        var dataType = context.TargetDataType;

        // SpecTypeId.Number is reported as "measurable" by Revit but has no units,
        // so UnitFormatUtils.TryParse() can't parse it. Use regex extraction instead.
        // Compare TypeId strings since ForgeTypeId == operator may not work as expected
        var isNumberType = dataType?.TypeId == SpecTypeId.Number.TypeId;
        Debug.WriteLine(
            $"[CoerceByStorageType.CanParseStringToDouble] isNumberType={isNumberType} (comparing {dataType?.TypeId} to {SpecTypeId.Number.TypeId})");
        if (isNumberType) {
            Debug.WriteLine(
                $"[CoerceByStorageType.CanParseStringToDouble] Target is Number (unitless), using regex, result={regexResult}");
            return regexResult;
        }

        // For measurable specs with actual units, use Revit's parser which understands imperial notation
        if (UnitUtils.IsMeasurableSpec(dataType)) {
            var parseResult = UnitFormatUtils.TryParse(context.FamilyDocument.GetUnits(), dataType, stringValue, out _);
            Debug.WriteLine(
                $"[CoerceByStorageType.CanParseStringToDouble] UnitFormatUtils.TryParse result={parseResult}");
            return parseResult;
        }

        // For non-measurable doubles, use simple regex extraction
        Debug.WriteLine($"[CoerceByStorageType.CanParseStringToDouble] Using regex, result={regexResult}");
        return regexResult;
    }

    /// <summary>
    ///     Parses a string value to double for the target parameter.
    ///     Uses Revit's UnitFormatUtils for measurable specs (handles imperial notation like "0' - 0 1/2\""),
    ///     falls back to regex extraction for plain numbers.
    /// </summary>
    private static double ParseStringToDouble(CoercionContext context) {
        var stringValue = context.SourceValue.ToString() ?? string.Empty;
        var dataType = context.TargetDataType;

        // SpecTypeId.Number is reported as "measurable" by Revit but has no units,
        // so UnitFormatUtils.TryParse() can't parse it. Use regex extraction instead.
        // Compare TypeId strings since ForgeTypeId == operator may not work as expected
        if (dataType?.TypeId == SpecTypeId.Number.TypeId) return Regexes.ExtractDouble(stringValue);

        // For measurable specs with actual units, use Revit's parser which understands imperial notation
        if (UnitUtils.IsMeasurableSpec(dataType)) {
            if (UnitFormatUtils.TryParse(context.FamilyDocument.GetUnits(), dataType, stringValue, out var parsed))
                return parsed;

            // Fall back to regex if Revit's parser fails (shouldn't happen if CanMap passed)
            throw new ArgumentException(
                $"Failed to parse '{stringValue}' as {dataType.ToLabel()} using Revit's UnitFormatUtils");
        }

        // For non-measurable doubles, use simple regex extraction
        return Regexes.ExtractDouble(stringValue);
    }
}