using Pe.Revit.Extensions.FamDocument.SetValue.Utils;
using Pe.Revit.Global;
using Pe.Revit.Parameters;

namespace Pe.Revit.Extensions.FamDocument.SetValue.CoercionStrategies;

/// <summary>
///     Storage type coercion strategy - handles cases where storage types differ but data types are compatible.
///     Implements comprehensive storage type conversions based on Revit's parameter system.
///     A mapping (param to param) carries units only through an explicit unit (ruling-ff-coercion 2026-09-18): two measurable specs
///     convert through a unit both accept, text into a measurable spec must name its own unit, and a value is never copied raw across
///     dimensions nor read in the project's display units. Such a value is refused, that value only. A bare number (Number, Integer,
///     unit-less text) into a measured spec is read in the mapping's declared unit; with none declared it is a
///     <see cref="MissingUnitException" />, reported by name (ruling 2026-09-19).
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
        if (UnitRefusal(context) is { } refusal) return refusal;
        var sourceValueText = context.SourceValue?.ToString() ?? string.Empty;
        var convertedValue = (context.SourceStorageType, context.TargetStorageType) switch {
            // Two measurable specs of one dimension (hvac:heatingLoad → hvac:power) convert through a unit both accept.
            (StorageType.Double, StorageType.Double) when context.SourceDataType is { } from && from != context.TargetDataType =>
                Bare(from) && context.SourceUnit is { } unit ? UnitUtils.ConvertToInternalUnits((double)context.SourceValue!, unit)
                    : UnitUtils.ConvertToInternalUnits(UnitUtils.ConvertFromInternalUnits((double)context.SourceValue!, SharedUnit(from, context.TargetDataType)!),
                        SharedUnit(from, context.TargetDataType)!),

            // Same type - no conversion needed
            _ when context.SourceStorageType == context.TargetStorageType => context.SourceValue,

            // There is only one relevant SpecTypeId that stores as an integer: SpecTypeId.Int.Integer.
            // Int.NumberOfPoles & Boolean.YesNo do too, but we can assume
            // 1) that the user will not attempt this conversion and 2) that these are already "properly" set.
            (StorageType.Integer, StorageType.Double) => context.SourceDataType is null
                ? UnitUtils.ConvertToInternalUnits(context.SourceValue as int? ?? 0, context.TargetUnitType)
                : context.SourceUnit is { } declared && Dimensioned(context.TargetDataType)
                    ? UnitUtils.ConvertToInternalUnits(context.SourceValue as int? ?? 0, declared)
                    : context.SourceValue as int? ?? 0,

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

    /// <summary>Why a mapping cannot carry this value without inventing a unit, or null.</summary>
    private static ArgumentException? UnitRefusal(CoercionContext context) {
        if (context.SourceDataType is not { } from) return null;
        var to = context.TargetDataType;
        return (context.SourceStorageType, context.TargetStorageType) switch {
            (StorageType.Double, StorageType.Double) when from != to && Bare(from) && Dimensioned(to) => context.SourceUnit is null ? Missing(context) : null,
            (StorageType.Double, StorageType.Double) when from != to && SharedUnit(from, to) is null => new ArgumentException(
                $"{from.TypeId} and {to.TypeId} share no unit; a value is never copied raw across dimensions" +
                (to == SpecTypeId.Number ? " (declare CoerceMeasurableToNumber to read it in a fixed unit)" : "")),
            (StorageType.Integer, StorageType.Double) when Dimensioned(to) => context.SourceUnit is null ? Missing(context) : null,
            (StorageType.Double, StorageType.Integer) when Dimensioned(from) => new ArgumentException($"{from.TypeId} is measured in a unit an integer cannot name"),
            _ => null
        };
    }

    private static MissingUnitException Missing(CoercionContext context) =>
        new($"a bare number names no unit for {context.TargetDataType.TypeId}; {MappingUnit.Hint(context.TargetParam)}");

    private static bool Dimensioned(ForgeTypeId spec) => UnitUtils.IsMeasurableSpec(spec) && spec != SpecTypeId.Number;

    /// <summary>A source that measures nothing: Number, or a spec with no units (Integer, Text).</summary>
    private static bool Bare(ForgeTypeId spec) => spec == SpecTypeId.Number || !UnitUtils.IsMeasurableSpec(spec);

    /// <summary>A unit valid for both specs, or null when they measure different dimensions.</summary>
    internal static ForgeTypeId? SharedUnit(ForgeTypeId from, ForgeTypeId to) {
        if (!UnitUtils.IsMeasurableSpec(from) || !UnitUtils.IsMeasurableSpec(to)) return null;
        var targetUnits = UnitUtils.GetValidUnits(to).Select(unit => unit.TypeId).ToHashSet(StringComparer.Ordinal);
        return UnitUtils.GetValidUnits(from).FirstOrDefault(unit => targetUnits.Contains(unit.TypeId));
    }

    /// <summary>
    ///     Parses measured text only when it names its own unit. The text is read under two different units of the spec: a bare number takes
    ///     whichever unit is set (as it would the project's hidden display unit) and so reads differently. A spec with one unit is unambiguous.
    /// </summary>
    internal static bool TryParseExplicitMeasure(ForgeTypeId spec, string text, out double value) {
        value = 0;
        if (string.IsNullOrWhiteSpace(text)) return false;
        var readings = new List<double>();
        foreach (var unit in UnitUtils.GetValidUnits(spec)) {
            Units under;
            try {
                under = new Units(UnitSystem.Metric);
                under.SetFormatOptions(spec, new FormatOptions(unit));
            } catch (Autodesk.Revit.Exceptions.ApplicationException) { continue; } // a unit whose default format options are invalid
            if (!ParameterStringIo.TryParseMeasuredValue(under, spec, text, out var read) &&
                !ParameterStringIo.TryParseMeasuredValue(under, spec, NormalizeForUnitParsing(text), out read)) return false;
            readings.Add(read);
            if (readings.Count == 2) break;
        }
        if (readings.Count == 0) return false;
        value = readings[0];
        return readings.Count == 1 || Math.Abs(readings[1] - value) <= 1e-9 * Math.Max(1d, Math.Abs(value));
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

        // For measurable specs with actual units, use Revit's parser which understands imperial notation. A mapping's bare number reaches
        // Map, which refuses it with a reason.
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

        // A mapping reads text in the unit it names, else in the mapping's declared unit; never the project's display unit.
        if (UnitUtils.IsMeasurableSpec(dataType) && context.SourceDataType is not null)
            return TryParseExplicitMeasure(dataType!, stringValue, out var named) ? named
                : context.SourceUnit is { } unit && Regexes.TryExtractDouble(stringValue, out var bare) ? UnitUtils.ConvertToInternalUnits(bare, unit)
                : throw new MissingUnitException($"'{stringValue}' names no unit for {dataType!.TypeId}; {MappingUnit.Hint(context.TargetParam)}");

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
