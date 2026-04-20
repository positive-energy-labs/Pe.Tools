using Pe.Revit.Global.Revit.Lib.Schedules;
using Pe.Shared.RevitData.Families;

namespace Pe.Revit.Global.Revit.Documents.Schedules;

public static class DocumentScheduleProfileExtensions {
    public static ScheduleProfile CaptureScheduleProfile(this ViewSchedule schedule) =>
        ScheduleHelper.SerializeSchedule(schedule);

    public static ScheduleCreationResult ApplyScheduleProfile(this Document doc, ScheduleProfile profile) =>
        ScheduleHelper.CreateSchedule(doc, profile);

    public static List<string> GetFamiliesMatchingScheduleProfileFilters(
        this Document doc,
        ScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamiliesMatchingFilters(doc, profile, families);

    public static List<long> GetFamilyIdsMatchingScheduleProfileFiltersAnyType(
        this Document doc,
        ScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, profile, families);

    internal static List<long> GetFamilyIdsMatchingScheduleProfileFiltersAnyType(
        this Document doc,
        ScheduleProfile profile,
        IReadOnlyList<TempPlacedSymbolRecord> placements
    ) => ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, profile, placements);
}
