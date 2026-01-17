using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using System.ComponentModel;
using System.Globalization;
using System.Text.Json.Serialization;

namespace Pe.Global.Revit.Lib;

public class OnFinishSettings {
    [Description("Automatically open the schedule when the command completes")]
    public bool OpenScheduleOnFinish { get; set; } = true;
}

public class ScheduleSpec {
    [Description("Settings for what to do when the command completes")]
    public OnFinishSettings OnFinish { get; set; } = new();

    [Description("The name of the schedule as it will appear in the project browser.")]
    public string Name { get; set; } = string.Empty;

    [Description("The Revit category to schedule (e.g., 'Mechanical Equipment', 'Plumbing Fixtures', 'Doors').")]
    [SchemaExamples(typeof(CategoryNamesProvider))]
    public string CategoryName { get; set; } = string.Empty;

    [Description(
        "Whether the schedule displays each element on a separate row (true) or combines multiple grouped elements onto the same row (false).")]
    public bool IsItemized { get; set; } = true;

    [Description("List of fields (columns) to include in the schedule.")]
    [Includable("fields")]
    public List<ScheduleFieldSpec> Fields { get; set; } = [];

    [Description("List of sort and grouping criteria for organizing schedule rows.")]
    public List<ScheduleSortGroupSpec> SortGroup { get; set; } = [];

    [Description("List of filters to restrict which elements appear in the schedule. Maximum of 8 filters.")]
    public List<ScheduleFilterSpec> Filters { get; set; } = [];

    [Description(
        "The name of the view template to apply to this schedule. Leave empty to use no template. Must be a schedule-compatible view template.")]
    [SchemaExamples(typeof(ScheduleViewTemplateNamesProvider))]
    public string? ViewTemplateName { get; set; }
}

public class ScheduleFieldSpec {
    [Description(
        "The parameter name to display in this column (e.g., 'Family and Type', 'Mark', 'PE_M_Fan_FlowRate').")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string ParameterName { get; set; } = string.Empty;

    [Description("Custom header text to display instead of the parameter name. Leave empty to use parameter name.")]
    public string ColumnHeaderOverride { get; set; } = string.Empty;

    [Description(
        "Header group name for visually grouping multiple column headers together (e.g., 'Performance', 'Electrical'). Consecutive fields with the same HeaderGroup value will be grouped.")]
    public string HeaderGroup { get; set; } = string.Empty;

    [Description("Whether to hide this column in the schedule while still using it for filtering or sorting.")]
    public bool IsHidden { get; set; }

    [Description("How to calculate aggregate values for this field (Standard, Totals, MinAndMax, Maximum, Minimum).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleFieldDisplayType DisplayType { get; set; } = ScheduleFieldDisplayType.Standard;

    [Description("Column width on sheet in feet. Leave empty to use default width.")]
    public double? ColumnWidth { get; set; } = 0.084;

    [Description("Horizontal alignment of the column data (Left, Center, Right).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleHorizontalAlignment HorizontalAlignment { get; set; } = ScheduleHorizontalAlignment.Center;

    [Description(
        "For calculated fields only. Indicates this is a formula or percentage field. Note: Formula strings cannot be read/written via Revit API - calculated fields must be created manually in Revit.")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public CalculatedFieldType? CalculatedType { get; set; }

    [Description("For Percentage calculated fields only. The name of the field to calculate percentages of.")]
    public string PercentageOfField { get; set; } = string.Empty;

    [Description("Formatting options for numeric fields. Leave null to use project settings.")]
    public ScheduleFieldFormatSpec? FormatOptions { get; set; }
}

/// <summary>
///     Formatting options for a schedule field. Controls how numeric values are displayed.
/// </summary>
public class ScheduleFieldFormatSpec {
    [Description("If true, uses project settings for formatting. All other properties are ignored when this is true.")]
    public bool UseDefault { get; set; } = true;

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
}

/// <summary>
///     Type of calculated field
/// </summary>
[JsonConverter(typeof(JsonStringEnumConverter))]
public enum CalculatedFieldType {
    [Description("A calculated field using a formula expression.")]
    Formula,

    [Description("A calculated field showing percentage of another field.")]
    Percentage
}

public class ScheduleSortGroupSpec {
    [Description("The field name to sort/group by.")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string FieldName { get; init; } = string.Empty;

    [Description("Sort direction (Ascending or Descending).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleSortOrder SortOrder { get; init; } = ScheduleSortOrder.Ascending;

    [Description("Whether to display a header row when this grouping changes.")]
    public bool ShowHeader { get; init; }

    [Description("Whether to display a footer row with totals when this grouping changes.")]
    public bool ShowFooter { get; init; }

    [Description("Whether to insert a blank line when this grouping changes.")]
    public bool ShowBlankLine { get; init; }
}

public class ScheduleFilterSpec {
    [Description("The field name to filter on.")]
    // [SchemaExamples(typeof(SchedulableParameterNamesProvider))]
    public string FieldName { get; init; } = string.Empty;

    [Description("The type of comparison to perform (Equal, Contains, GreaterThan, etc.).")]
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public ScheduleFilterType FilterType { get; init; } = ScheduleFilterType.Equal;

    [Description(
        "The filter value as a string. Leave empty for HasParameter, HasValue, and HasNoValue filter types. The value will be automatically coerced to the correct type based on the field's parameter type (string, integer, double, or ElementId).")]
    public string Value { get; set; } = string.Empty;
}

public class ScheduleCreationResult {
    public required ViewSchedule Schedule { get; set; }
    public required string ScheduleName { get; set; }
    public required string CategoryName { get; set; }
    public bool IsItemized { get; set; }

    public List<AppliedFieldInfo> AppliedFields { get; set; } = [];
    public List<string> SkippedFields { get; set; } = [];

    public List<AppliedSortGroupInfo> AppliedSortGroups { get; set; } = [];
    public List<string> SkippedSortGroups { get; set; } = [];

    public List<AppliedFilterInfo> AppliedFilters { get; set; } = [];
    public List<string> SkippedFilters { get; set; } = [];

    public List<string> AppliedHeaderGroups { get; set; } = [];
    public List<string> SkippedHeaderGroups { get; set; } = [];

    public List<CalculatedFieldGuidance> SkippedCalculatedFields { get; set; } = [];
    public List<string> Warnings { get; set; } = [];

    public string? AppliedViewTemplate { get; set; }
    public string? SkippedViewTemplate { get; set; }
}

public class AppliedFieldInfo {
    public required string ParameterName { get; set; }
    public required string ColumnHeaderOverride { get; set; }
    public bool IsHidden { get; set; }
    public double? ColumnWidth { get; set; }
    public ScheduleFieldDisplayType DisplayType { get; set; }
    public ScheduleHorizontalAlignment HorizontalAlignment { get; set; }
}

public class AppliedSortGroupInfo {
    public required string FieldName { get; set; }
    public ScheduleSortOrder SortOrder { get; set; }
    public bool ShowHeader { get; set; }
    public bool ShowFooter { get; set; }
    public bool ShowBlankLine { get; set; }
}

public class AppliedFilterInfo {
    public required string FieldName { get; set; }
    public ScheduleFilterType FilterType { get; set; }
    public required string Value { get; set; }
    public required string StorageType { get; set; }
}

public class CalculatedFieldGuidance {
    public required string FieldName { get; set; }
    public required string CalculatedType { get; set; } // "Formula" or "Percentage"
    public string? Guidance { get; set; }
    public string? PercentageOfField { get; set; } // Only for percentage fields - can be null for non-percentage fields
}