using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

public static class ScheduleProfileDefaults {
    public const bool IsItemized = true;
    public const bool FilterBySheet = false;
    public const bool FieldIsHidden = false;
    public const ScheduleAuthoredFieldDisplayType FieldDisplayType = ScheduleAuthoredFieldDisplayType.Standard;
    public const ScheduleFieldHorizontalAlignment FieldHorizontalAlignment = ScheduleFieldHorizontalAlignment.Center;
    public const ScheduleAuthoredSortOrder SortOrder = ScheduleAuthoredSortOrder.Ascending;
    public const bool ShowHeader = false;
    public const bool ShowFooter = false;
    public const bool ShowBlankLine = false;
    public const ScheduleAuthoredFilterType FilterType = ScheduleAuthoredFilterType.Equal;

    public static ScheduleProfile Normalize(ScheduleProfile profile) {
        ArgumentNullException.ThrowIfNull(profile);

        return profile with {
            Fields = profile.Fields ?? [],
            SortGroup = profile.SortGroup ?? [],
            Filters = profile.Filters ?? []
        };
    }
}
