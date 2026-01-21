using Pe.Global.PolyFill;
using System.ComponentModel;
using System.Globalization;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib.Schedules.Filters;

public class ScheduleFilterSpec {
    [Description("The field name to filter on.")]
    public string FieldName { get; init; } = string.Empty;

    [Description("The type of comparison to perform (Equal, Contains, GreaterThan, etc.).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleFilterType FilterType { get; init; } = ScheduleFilterType.Equal;

    [Description(
        "The filter value as a string. Leave empty for HasParameter, HasValue, and HasNoValue filter types. The value will be automatically coerced to the correct type based on the field's parameter type (string, integer, double, or ElementId).")]
    public string Value { get; set; } = string.Empty;

    /// <summary>
    ///     Serializes a ScheduleFilter into a ScheduleFilterSpec.
    /// </summary>
    public static ScheduleFilterSpec SerializeFrom(ScheduleFilter filter, ScheduleDefinition def) {
        var field = def.GetField(filter.FieldId);
        var fieldName = field.GetName();

        // Extract value as string based on type
        var value = string.Empty;
        if (filter.IsStringValue)
            value = filter.GetStringValue();
        else if (filter.IsIntegerValue)
            value = filter.GetIntegerValue().ToString();
        else if (filter.IsDoubleValue)
            value = filter.GetDoubleValue().ToString(CultureInfo.InvariantCulture);
        else if (filter.IsElementIdValue)
            value = filter.GetElementIdValue().Value().ToString();

        return new ScheduleFilterSpec { FieldName = fieldName, FilterType = filter.FilterType, Value = value };
    }

    /// <summary>
    ///     Applies this filter spec to a schedule.
    ///     Returns (applied info, skipped reason, warning) - applied or skipped will be non-null.
    /// </summary>
    public (AppliedFilterInfo? Applied, string? Skipped, string? Warning) ApplyTo(ScheduleDefinition def) {
        // Find the field by name
        ScheduleField? field = null;
        for (var i = 0; i < def.GetFieldCount(); i++) {
            var f = def.GetField(i);
            if (f.GetName() == this.FieldName) {
                field = f;
                break;
            }
        }

        if (field == null) return (null, $"Field '{this.FieldName}' not found", null);

        try {
            ScheduleFilter filter;
            string storageTypeStr;

            // Filters that don't require a value
            if (string.IsNullOrEmpty(this.Value)) {
                filter = new ScheduleFilter(field.FieldId, this.FilterType);
                storageTypeStr = "None";
            } else {
                // Use SpecStorageTypeResolver to determine the correct type and constructor
                var specTypeId = field.GetSpecTypeId();
                var storageType = SpecStorageTypeResolver.GetStorageType(specTypeId);

                if (storageType == StorageType.Integer && int.TryParse(this.Value, out var intValue)) {
                    filter = new ScheduleFilter(field.FieldId, this.FilterType, intValue);
                    storageTypeStr = "Integer";
                } else if (storageType == StorageType.Double &&
                           double.TryParse(this.Value, out var doubleValue)) {
                    filter = new ScheduleFilter(field.FieldId, this.FilterType, doubleValue);
                    storageTypeStr = "Double";
                } else if (storageType == StorageType.ElementId &&
                           int.TryParse(this.Value, out var elementIdValue)) {
                    var elementId = new ElementId(elementIdValue);
                    filter = new ScheduleFilter(field.FieldId, this.FilterType, elementId);
                    storageTypeStr = "ElementId";
                } else {
                    // Default to string for text parameters or StorageType.String/unhandled types
                    filter = new ScheduleFilter(field.FieldId, this.FilterType, this.Value);
                    storageTypeStr = "String";
                }
            }

            def.AddFilter(filter);

            var applied = new AppliedFilterInfo {
                FieldName = this.FieldName,
                FilterType = this.FilterType,
                Value = this.Value,
                StorageType = storageTypeStr
            };

            return (applied, null, null);
        } catch (Exception ex) {
            return (null, null, $"Failed to apply filter on field '{this.FieldName}': {ex.Message}");
        }
    }
}