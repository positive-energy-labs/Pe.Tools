using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

public static class ScheduleClosedEnumValueDomain {
    public static ScheduleFieldDisplayType ToRevit(this ScheduleAuthoredFieldDisplayType value) =>
        value switch {
            ScheduleAuthoredFieldDisplayType.Standard => ScheduleFieldDisplayType.Standard,
            ScheduleAuthoredFieldDisplayType.Totals => ScheduleFieldDisplayType.Totals,
            ScheduleAuthoredFieldDisplayType.MinMax => ScheduleFieldDisplayType.MinMax,
            ScheduleAuthoredFieldDisplayType.Max => ScheduleFieldDisplayType.Max,
            ScheduleAuthoredFieldDisplayType.Min => ScheduleFieldDisplayType.Min,
            _ => ScheduleFieldDisplayType.Standard
        };

    public static ScheduleHorizontalAlignment ToRevit(this ScheduleFieldHorizontalAlignment value) =>
        value switch {
            ScheduleFieldHorizontalAlignment.Left => ScheduleHorizontalAlignment.Left,
            ScheduleFieldHorizontalAlignment.Center => ScheduleHorizontalAlignment.Center,
            ScheduleFieldHorizontalAlignment.Right => ScheduleHorizontalAlignment.Right,
            _ => ScheduleHorizontalAlignment.Center
        };

    public static ScheduleSortOrder ToRevit(this ScheduleAuthoredSortOrder value) =>
        value == ScheduleAuthoredSortOrder.Descending ? ScheduleSortOrder.Descending : ScheduleSortOrder.Ascending;

    public static ScheduleFilterType ToRevit(this ScheduleAuthoredFilterType value) =>
        value switch {
            ScheduleAuthoredFilterType.HasParameter => ScheduleFilterType.HasParameter,
            ScheduleAuthoredFilterType.Equal => ScheduleFilterType.Equal,
            ScheduleAuthoredFilterType.NotEqual => ScheduleFilterType.NotEqual,
            ScheduleAuthoredFilterType.GreaterThan => ScheduleFilterType.GreaterThan,
            ScheduleAuthoredFilterType.GreaterThanOrEqual => ScheduleFilterType.GreaterThanOrEqual,
            ScheduleAuthoredFilterType.LessThan => ScheduleFilterType.LessThan,
            ScheduleAuthoredFilterType.LessThanOrEqual => ScheduleFilterType.LessThanOrEqual,
            ScheduleAuthoredFilterType.Contains => ScheduleFilterType.Contains,
            ScheduleAuthoredFilterType.NotContains => ScheduleFilterType.NotContains,
            ScheduleAuthoredFilterType.BeginsWith => ScheduleFilterType.BeginsWith,
            ScheduleAuthoredFilterType.NotBeginsWith => ScheduleFilterType.NotBeginsWith,
            ScheduleAuthoredFilterType.EndsWith => ScheduleFilterType.EndsWith,
            ScheduleAuthoredFilterType.NotEndsWith => ScheduleFilterType.NotEndsWith,
            ScheduleAuthoredFilterType.IsAssociatedWithGlobalParameter =>
                ScheduleFilterType.IsAssociatedWithGlobalParameter,
            ScheduleAuthoredFilterType.IsNotAssociatedWithGlobalParameter =>
                ScheduleFilterType.IsNotAssociatedWithGlobalParameter,
            ScheduleAuthoredFilterType.HasValue => ScheduleFilterType.HasValue,
            ScheduleAuthoredFilterType.HasNoValue => ScheduleFilterType.HasNoValue,
            _ => ScheduleFilterType.Equal
        };

    public static ScheduleAuthoredFieldDisplayType ToAuthored(this ScheduleFieldDisplayType value) =>
        value switch {
            ScheduleFieldDisplayType.Totals => ScheduleAuthoredFieldDisplayType.Totals,
            ScheduleFieldDisplayType.MinMax => ScheduleAuthoredFieldDisplayType.MinMax,
            ScheduleFieldDisplayType.Max => ScheduleAuthoredFieldDisplayType.Max,
            ScheduleFieldDisplayType.Min => ScheduleAuthoredFieldDisplayType.Min,
            _ => ScheduleAuthoredFieldDisplayType.Standard
        };

    public static ScheduleFieldHorizontalAlignment ToAuthored(this ScheduleHorizontalAlignment value) =>
        value switch {
            ScheduleHorizontalAlignment.Left => ScheduleFieldHorizontalAlignment.Left,
            ScheduleHorizontalAlignment.Right => ScheduleFieldHorizontalAlignment.Right,
            _ => ScheduleFieldHorizontalAlignment.Center
        };

    public static ScheduleAuthoredSortOrder ToAuthored(this ScheduleSortOrder value) =>
        value == ScheduleSortOrder.Descending
            ? ScheduleAuthoredSortOrder.Descending
            : ScheduleAuthoredSortOrder.Ascending;

    public static ScheduleAuthoredFilterType ToAuthored(this ScheduleFilterType value) =>
        value switch {
            ScheduleFilterType.HasParameter => ScheduleAuthoredFilterType.HasParameter,
            ScheduleFilterType.NotEqual => ScheduleAuthoredFilterType.NotEqual,
            ScheduleFilterType.GreaterThan => ScheduleAuthoredFilterType.GreaterThan,
            ScheduleFilterType.GreaterThanOrEqual => ScheduleAuthoredFilterType.GreaterThanOrEqual,
            ScheduleFilterType.LessThan => ScheduleAuthoredFilterType.LessThan,
            ScheduleFilterType.LessThanOrEqual => ScheduleAuthoredFilterType.LessThanOrEqual,
            ScheduleFilterType.Contains => ScheduleAuthoredFilterType.Contains,
            ScheduleFilterType.NotContains => ScheduleAuthoredFilterType.NotContains,
            ScheduleFilterType.BeginsWith => ScheduleAuthoredFilterType.BeginsWith,
            ScheduleFilterType.NotBeginsWith => ScheduleAuthoredFilterType.NotBeginsWith,
            ScheduleFilterType.EndsWith => ScheduleAuthoredFilterType.EndsWith,
            ScheduleFilterType.NotEndsWith => ScheduleAuthoredFilterType.NotEndsWith,
            ScheduleFilterType.IsAssociatedWithGlobalParameter =>
                ScheduleAuthoredFilterType.IsAssociatedWithGlobalParameter,
            ScheduleFilterType.IsNotAssociatedWithGlobalParameter =>
                ScheduleAuthoredFilterType.IsNotAssociatedWithGlobalParameter,
            ScheduleFilterType.HasValue => ScheduleAuthoredFilterType.HasValue,
            ScheduleFilterType.HasNoValue => ScheduleAuthoredFilterType.HasNoValue,
            _ => ScheduleAuthoredFilterType.Equal
        };
}
