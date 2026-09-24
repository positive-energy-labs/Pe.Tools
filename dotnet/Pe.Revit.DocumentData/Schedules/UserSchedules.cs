using System.Diagnostics.CodeAnalysis;

namespace Pe.Revit.DocumentData.Schedules;

/// <summary>
///     The one door to schedules a user sees: never a titleblock revision schedule, an internal keynote schedule, or a
///     sheet-filtered internal copy. Templates stay the caller's filter. Only unique-name and template lookups bypass it.
/// </summary>
public static class UserScheduleDoor {
    public static IEnumerable<ViewSchedule> UserSchedules(this Document doc) =>
        new FilteredElementCollector(doc).OfClass(typeof(ViewSchedule)).Cast<ViewSchedule>().Where(IsUserSchedule);

    public static bool TryGetUserSchedule(this Document doc, ElementId id, [NotNullWhen(true)] out ViewSchedule? schedule) {
        schedule = doc.GetElement(id) as ViewSchedule;
        if (schedule != null && IsUserSchedule(schedule)) return true;
        schedule = null;
        return false;
    }

    private static bool IsUserSchedule(ViewSchedule schedule) =>
        !schedule.IsTitleblockRevisionSchedule && !schedule.IsInternalKeynoteSchedule && !IsSheetFilteredInternalCopy(schedule);

    // Revit backs each sheet-filtered placement with a hidden "<schedule> InternalN" view carrying the parent's filter flag.
    // FOOTGUN: sheet-filtered internal copy naming rule unproven in a session (localized builds, renames, user names ending "InternalN").
    private static bool IsSheetFilteredInternalCopy(ViewSchedule schedule) {
        if (schedule.Definition?.IsFilteredBySheet != true) return false;
        var at = schedule.Name.LastIndexOf(" Internal", StringComparison.OrdinalIgnoreCase);
        var digits = at < 0 ? "" : schedule.Name.Substring(at + " Internal".Length);
        return digits.Length > 0 && digits.All(c => c is >= '0' and <= '9');
    }
}
