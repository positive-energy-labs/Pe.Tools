using System.ComponentModel;

namespace Pe.Global.Revit.Lib.Schedules.Fields;

/// <summary>
///     Formatting options for a schedule field. Controls how numeric values are displayed.
/// </summary>
public class ScheduleFieldFormatSpec {
    [Description(
        "The unit type ID string (e.g., 'autodesk.unit.unit:britishThermalUnitsPerHour-1.0.1'). Get this from serializing an existing schedule.")]
    public string? UnitTypeId { get; set; }

    [Description(
        "The symbol type ID string (e.g., 'autodesk.unit.symbol:btuPerHour-1.0.0' for 'BTU/h'). Leave null for no symbol.")]
    public string? SymbolTypeId { get; set; }

    [Description(
        "The accuracy/rounding value. For decimal display, use powers of 10 (e.g., 1.0 for 0 decimals, 0.01 for 2 decimals). For fractions, use powers of 2 (e.g., 0.25 for 1/4\").")]
    public double? Accuracy { get; set; }

    [Description("If true, trailing zeros after the decimal point are hidden.")]
    public bool SuppressTrailingZeros { get; set; }

    [Description("If true, leading zeros are hidden (e.g., displays '.5' instead of '0.5' for feet-inches).")]
    public bool SuppressLeadingZeros { get; set; }

    [Description("If true, displays a '+' prefix for positive and zero values.")]
    public bool UsePlusPrefix { get; set; }

    [Description("If true, displays digit grouping separators (e.g., '1,000' instead of '1000').")]
    public bool UseDigitGrouping { get; set; }

    [Description("If true, spaces are suppressed in the display (e.g., for feet-inches notation).")]
    public bool SuppressSpaces { get; set; }

    /// <summary>
    ///     Serializes format options from a ScheduleField.
    ///     Returns null if the field uses default formatting or doesn't support format options.
    /// </summary>
    public static ScheduleFieldFormatSpec? SerializeFrom(ScheduleField field) {
        try {
            var formatOptions = field.GetFormatOptions();
            if (formatOptions == null) return null;

            // If using defaults, just return null
            if (formatOptions.UseDefault) return null;

            var spec = new ScheduleFieldFormatSpec {
                UnitTypeId = formatOptions.GetUnitTypeId()?.TypeId,
                Accuracy = formatOptions.Accuracy,
                SuppressTrailingZeros = formatOptions.SuppressTrailingZeros,
                SuppressLeadingZeros = formatOptions.SuppressLeadingZeros,
                UsePlusPrefix = formatOptions.UsePlusPrefix,
                UseDigitGrouping = formatOptions.UseDigitGrouping,
                SuppressSpaces = formatOptions.SuppressSpaces
            };

            // Get symbol if available
            if (formatOptions.CanHaveSymbol()) {
                var symbolId = formatOptions.GetSymbolTypeId();
                if (symbolId != null && !symbolId.Empty())
                    spec.SymbolTypeId = symbolId.TypeId;
            }

            return spec;
        } catch {
            // Field may not support format options (e.g., text fields)
            return null;
        }
    }

    /// <summary>
    ///     Applies this format spec to a schedule field.
    ///     Returns a warning message if application fails, null on success.
    /// </summary>
    public string? ApplyTo(ScheduleField field, string fieldName) {
        try {
            // Create custom format options
            FormatOptions formatOptions;

            if (!string.IsNullOrEmpty(this.UnitTypeId)) {
                var unitTypeId = new ForgeTypeId(this.UnitTypeId);
                formatOptions = new FormatOptions(unitTypeId);
            } else
                formatOptions = new FormatOptions { UseDefault = false };

            // Apply accuracy if specified
            if (this.Accuracy.HasValue && formatOptions.IsValidAccuracy(this.Accuracy.Value))
                formatOptions.Accuracy = this.Accuracy.Value;

            // Apply symbol if specified
            if (!string.IsNullOrEmpty(this.SymbolTypeId) && formatOptions.CanHaveSymbol()) {
                var symbolTypeId = new ForgeTypeId(this.SymbolTypeId);
                if (formatOptions.IsValidSymbol(symbolTypeId))
                    formatOptions.SetSymbolTypeId(symbolTypeId);
            }

            // Apply boolean options where supported
            if (formatOptions.CanSuppressTrailingZeros())
                formatOptions.SuppressTrailingZeros = this.SuppressTrailingZeros;

            if (formatOptions.CanSuppressLeadingZeros())
                formatOptions.SuppressLeadingZeros = this.SuppressLeadingZeros;

            if (formatOptions.CanUsePlusPrefix())
                formatOptions.UsePlusPrefix = this.UsePlusPrefix;

            formatOptions.UseDigitGrouping = this.UseDigitGrouping;

            if (formatOptions.CanSuppressSpaces())
                formatOptions.SuppressSpaces = this.SuppressSpaces;

            field.SetFormatOptions(formatOptions);
            return null;
        } catch (Exception ex) {
            return $"Failed to apply format options for field '{fieldName}': {ex.Message}";
        }
    }
}