using Pe.Revit.DocumentData.Parameters;
using Pe.Revit.DocumentData.Schedules.Authored.ValueDomains;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.DocumentData.Schedules.Authored;

public static class ScheduleProfileResolver {
    public static ElementId ResolveCategoryId(Document doc, ScheduleProfile profile) =>
        ScheduleCategoryValueDomain.ResolveCategoryId(doc, profile.CategoryName);

    public static BuiltInCategory ResolveBuiltInCategory(ScheduleProfile profile) =>
        ScheduleCategoryValueDomain.ResolveBuiltInCategory(profile.CategoryName);

    public static string GetCategoryDisplayName(ScheduleProfile profile) {
        var category = ResolveBuiltInCategory(profile);
        return RevitLabelCatalog.GetLabelForBuiltInCategory(category);
    }
}
