using Pe.Revit.Extensions.FamDocument.SetValue.Utils;
using Pe.Revit.Global;
using Pe.Revit.Parameters;

namespace Pe.Revit.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Storage type coercion strategy - handles cases where storage types differ but data types are compatible.
///     Implements comprehensive storage type conversions based on Revit's parameter system.
/// </summary>
public class CoerceByStorageType : ICoercionStrategy {
    public bool CanMap(CoercionContext context) {
        if (context.SourceStorageType == context.TargetStorageType)
            return true;

        return (context.SourceStorageType, context.TargetStorageType) switch {
            (StorageType.Integer, StorageType.String) => true,
            (StorageType.Integer, StorageType.Double) => true,
            (StorageType.Double, StorageType.String) => true,
            (StorageType.Double, StorageType.Integer) => context.SourceValue is double,
            (StorageType.String, StorageType.Integer) => CanParseStringToInteger(context),
            (StorageType.String, StorageType.Double) => CanParseStringToDouble(context),
            _ => false
        };
    }

    public Result<FamilyParameter> Map(CoercionContext context) {
        var sourceValueText = context.SourceValue?.ToString() ?? string.Empty;
        var convertedValue = (context.SourceStorageType, context.TargetStorageType) switch {
            // Same type - no conversion needed
            _ when context.SourceStorageType == context.TargetStorageType => context.SourceValue,

            // There is only one relevant SpecTypeId that stores as an integer: SpecTypeId.Int.Integer.
            // Int.NumberOfPoles & Boolean.YesNo do too, but we can assume
            // 1) that the user will not attempt this conversion and 2) that these are already "properly" set.
            (StorageType.Integer, StorageType.Double) => UnitUtils.ConvertToInternalUnits(
                context.SourceValue as int? ?? 0, context.TargetUnitType),

            // Safe to simply .ToString() on the integerParam's value
            (StorageType.Integer, StorageType.String) => sourceValueText,

            // Try to use the SourceValueString if it is available, otherwise fall back to ToString()
            (StorageType.Double, StorageType.String) => context.SourceValueString ?? sourceValueText,

            // Round the numeric value; the display string is formatted ("1' - 6\"", "$1,200") and scraping it loses or throws.
            // ponytail: rounds the internal-unit double, so a measurable source lands in feet; add a unit convert if an
            // integer destination ever needs display units.
            (StorageType.Double, StorageType.Integer) =>
                (int)Math.Round(context.SourceValue as double? ?? 0, MidpointRounding.AwayFromZero),

            // Set to integer by extracting integer from the stringParam's value
            (StorageType.String, StorageType.Integer) =>
                Regexes.TryExtractInteger(sourceValueText, out var integer)
                    ? integer
                    : TryParseNumberWord(sourceValueText, out var word) ? word : ParseStringToYesNo(sourceValueText),

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
    ///     Checks if a string value can be parsed to integer.
    ///     Handles both numeric strings and Yes/No boolean values.
    /// </summary>
    private static bool CanParseStringToInteger(CoercionContext context) {
        var stringValue = context.SourceValue?.ToString();
        if (string.IsNullOrWhiteSpace(stringValue)) return false;

        // Check for Yes/No boolean values
        if (stringValue is "Yes" or "No") return true;
        if (TryParseNumberWord(stringValue, out _)) return true;

        // Check for numeric integer values
        return Regexes.TryExtractInteger(stringValue, out _);
    }

    /// <summary>
    ///     Checks if a string value can be parsed to double for the target parameter.
    ///     Uses Revit's UnitFormatUtils for measurable specs (handles imperial notation like "0' - 1/2\""),
    ///     falls back to regex extraction for plain numbers.
    /// </summary>
    private static bool CanParseStringToDouble(CoercionContext context) {
        var stringValue = context.SourceValue?.ToString();

        var regexResult = Regexes.TryExtractDouble(stringValue, out _) &&
                          !string.IsNullOrWhiteSpace(stringValue);

        if (string.IsNullOrWhiteSpace(stringValue)) return false;

        var dataType = context.TargetDataType;

        // SpecTypeId.Number is reported as "measurable" by Revit but has no units,
        // so UnitFormatUtils.TryParse() can't parse it. Use regex extraction instead.
        // Compare TypeId strings since ForgeTypeId == operator may not work as expected
        // Number words ("Single", "Two-Pole") only ever mean a count: unitless targets only, never a measurable spec.
        var isNumberType = dataType?.TypeId == SpecTypeId.Number.TypeId;
        if (isNumberType)
            return regexResult || TryParseNumberWord(stringValue, out _);

        // For measurable specs with actual units, use Revit's parser which understands imperial notation
        if (UnitUtils.IsMeasurableSpec(dataType)) {
            var parseResult = ParameterStringIo.TryParseMeasuredValue(
                context.FamilyDocument.GetUnits(),
                dataType,
                stringValue,
                out _
            );
            if (!parseResult) {
                var normalizedValue = NormalizeForUnitParsing(stringValue);
                parseResult = ParameterStringIo.TryParseMeasuredValue(
                    context.FamilyDocument.GetUnits(),
                    dataType,
                    normalizedValue,
                    out _
                );
            }

            return parseResult;
        }

        // For non-measurable doubles, use simple regex extraction
        return regexResult;
    }

    /// <summary>
    ///     Parses a string value to double for the target parameter.
    ///     Uses Revit's UnitFormatUtils for measurable specs (handles imperial notation like "0' - 0 1/2\""),
    ///     falls back to regex extraction for plain numbers.
    /// </summary>
    private static double ParseStringToDouble(CoercionContext context) {
        var stringValue = context.SourceValue?.ToString() ?? string.Empty;
        var dataType = context.TargetDataType;

        // SpecTypeId.Number is reported as "measurable" by Revit but has no units,
        // so UnitFormatUtils.TryParse() can't parse it. Use regex extraction instead.
        // Compare TypeId strings since ForgeTypeId == operator may not work as expected
        if (dataType?.TypeId == SpecTypeId.Number.TypeId)
            return Regexes.TryExtractDouble(stringValue, out var number) ? number
                : TryParseNumberWord(stringValue, out var word) ? word
                : Regexes.ExtractDouble(stringValue);

        // For measurable specs with actual units, use Revit's parser which understands imperial notation
        if (UnitUtils.IsMeasurableSpec(dataType)) {
            if (ParameterStringIo.TryParseMeasuredValue(context.FamilyDocument.GetUnits(), dataType, stringValue, out var parsed))
                return parsed;

            var normalizedValue = NormalizeForUnitParsing(stringValue);
            if (ParameterStringIo.TryParseMeasuredValue(context.FamilyDocument.GetUnits(), dataType, normalizedValue, out parsed))
                return parsed;

            throw new ArgumentException(
                $"Failed to parse '{stringValue}' as {dataType!.ToLabel()} using Revit's UnitFormatUtils");
        }

        // For non-measurable doubles, use simple regex extraction
        return Regexes.ExtractDouble(stringValue);
    }

    private static readonly (string Word, int Value)[] NumberWords = [
        ("zero", 0), ("none", 0),
        ("single", 1), ("one", 1), ("mono", 1),
        ("double", 2), ("dual", 2), ("two", 2), ("twin", 2), ("bi", 2),
        ("triple", 3), ("three", 3), ("tri", 3),
        ("quad", 4), ("four", 4),
        ("five", 5), ("six", 6), ("seven", 7), ("eight", 8), ("nine", 9), ("ten", 10), ("eleven", 11), ("twelve", 12)
    ];

    /// <summary>
    ///     Text that names a count ("Single", "Three-Pole", "dual", "Twelve") coerces to that number when no digit is present.
    ///     Longest word wins so "twin" is not read as "two"; the word must start the text and end at a non-letter.
    /// </summary>
    internal static bool TryParseNumberWord(string text, out int value) {
        var word = text.Trim().ToLowerInvariant();
        foreach (var (candidate, number) in NumberWords.OrderByDescending(entry => entry.Word.Length)) {
            if (!word.StartsWith(candidate, StringComparison.Ordinal)) continue;
            if (word.Length > candidate.Length && char.IsLetter(word[candidate.Length])) continue;
            value = number;
            return true;
        }
        value = 0;
        return false;
    }

    private static int ParseStringToYesNo(string stringValue) {
        if (stringValue == "Yes") return 1;
        if (stringValue == "No") return 0;
        return 0;
    }

    /// <summary>
    ///     Normalizes a string for unit parsing by removing commas and whitespace.
    ///     This is necessary for fallback behavior
    /// </summary>
    private static string NormalizeForUnitParsing(string input) =>
        string.IsNullOrWhiteSpace(input)
            ? string.Empty
            : input.Replace(",", string.Empty).Trim();
}
