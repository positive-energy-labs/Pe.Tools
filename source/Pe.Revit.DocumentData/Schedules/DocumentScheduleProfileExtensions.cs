using Pe.Revit.DocumentData.Families.Loaded;
using Pe.Revit.DocumentData.Schedules.Apply;
using Pe.Revit.DocumentData.Schedules.Runtime;
using SharedScheduleProfile = Pe.Shared.RevitData.Schedules.ScheduleProfile;

namespace Pe.Revit.DocumentData.Schedules;

public static class DocumentScheduleProfileExtensions {
    public static ScheduleProfile CaptureRuntimeScheduleProfile(this ViewSchedule schedule) =>
        ScheduleHelper.SerializeSchedule(schedule);

    public static SharedScheduleProfile CaptureAuthoredScheduleProfile(this ViewSchedule schedule) =>
        schedule.CaptureRuntimeScheduleProfile().ToAuthoredProfile();

    public static ScheduleCreationResult ApplyScheduleProfile(this Document doc, ScheduleProfile profile) =>
        ScheduleHelper.CreateSchedule(doc, profile);

    public static ScheduleCreationResult ApplyScheduleProfile(this Document doc, SharedScheduleProfile profile) =>
        ScheduleHelper.CreateSchedule(doc, profile.ToRuntimeProfile());

    public static List<string> GetFamiliesMatchingScheduleProfileFilters(
        this Document doc,
        ScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamiliesMatchingFilters(doc, profile, families);

    public static List<string> GetFamiliesMatchingScheduleProfileFilters(
        this Document doc,
        SharedScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamiliesMatchingFilters(doc, profile.ToRuntimeProfile(), families);

    public static List<long> GetFamilyIdsMatchingScheduleProfileFiltersAnyType(
        this Document doc,
        ScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, profile, families);

    public static List<long> GetFamilyIdsMatchingScheduleProfileFiltersAnyType(
        this Document doc,
        SharedScheduleProfile profile,
        IEnumerable<Family>? families = null
    ) => ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, profile.ToRuntimeProfile(), families);

    internal static List<long> GetFamilyIdsMatchingScheduleProfileFiltersAnyType(
        this Document doc,
        ScheduleProfile profile,
        IReadOnlyList<TempPlacedSymbolRecord> placements
    ) => ScheduleHelper.GetFamilyIdsMatchingFiltersAnyType(doc, profile, placements);
}

// PE_HOT_RELOAD_NUDGE
