using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Extensions.UiApplication;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Static class containing collection and action handler methods for View palette.
/// </summary>
internal static class ViewActions {
    /// <summary>
    ///     Collects all views, schedules, and sheets in the document.
    /// </summary>
    internal static IEnumerable<UnifiedViewItem> CollectAllViews(Document doc, SheetLookupCache sheetCache) {
        var items = new List<UnifiedViewItem>();

        // Collect regular views
        items.AddRange(CollectViews(doc, sheetCache));

        // Collect schedules
        items.AddRange(CollectSchedules(doc, sheetCache));

        // Collect sheets
        items.AddRange(CollectSheets(doc, sheetCache));

        return items.OrderBy(i => i.TextPrimary);
    }

    /// <summary>
    ///     Collects only regular views (excluding templates, schedules, and sheets).
    /// </summary>
    internal static IEnumerable<UnifiedViewItem> CollectViews(Document doc, SheetLookupCache sheetCache) {
        var views = new FilteredElementCollector(doc)
            .OfClass(typeof(View))
            .Cast<View>()
            .Where(v => !v.IsTemplate
                        && v.ViewType != ViewType.Legend
                        && v.ViewType != ViewType.DrawingSheet
                        && v.ViewType != ViewType.DraftingView
                        && v.ViewType != ViewType.SystemBrowser
                        && v.ViewType != ViewType.ProjectBrowser
                        && v is not ViewSchedule
                        && v is not ViewSheet);

        foreach (var view in views)
            yield return new UnifiedViewItem(view, ViewItemType.View, sheetCache);
    }

    /// <summary>
    ///     Collects only schedules (excluding revision schedules).
    /// </summary>
    internal static IEnumerable<UnifiedViewItem> CollectSchedules(Document doc, SheetLookupCache sheetCache) {
        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(s => !s.Name.Contains("<Revision Schedule>"));

        foreach (var schedule in schedules)
            yield return new UnifiedViewItem(schedule, ViewItemType.Schedule, sheetCache);
    }

    /// <summary>
    ///     Collects only sheets.
    /// </summary>
    internal static IEnumerable<UnifiedViewItem> CollectSheets(Document doc, SheetLookupCache sheetCache) {
        var sheets = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>();

        foreach (var sheet in sheets)
            yield return new UnifiedViewItem(sheet, ViewItemType.Sheet, sheetCache);
    }

    /// <summary>
    ///     Opens and activates a view.
    /// </summary>
    internal static void HandleOpen(UIApplication uiapp, UnifiedViewItem? item) {
        if (item?.View != null)
            uiapp.OpenAndActivateView(item.View);
    }

    /// <summary>
    ///     Opens RevitLookup to snoop the selected view.
    /// </summary>
    internal static void HandleSnoop(UIApplication uiapp, Document doc, UnifiedViewItem? item) {
        if (item == null) return;
        var title = item.ItemType switch {
            ViewItemType.View => $"View: {item.View.Name}",
            ViewItemType.Schedule => $"Schedule: {item.View.Name}",
            ViewItemType.Sheet => $"Sheet: {item.View.Name}",
            _ => item.View.Name
        };
        _ = RevitDbExplorerService.TrySnoopObject(uiapp, doc, item.View, title);
    }
}
