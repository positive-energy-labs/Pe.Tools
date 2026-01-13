using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.ViewPalette;
using Pe.Extensions.UiApplication;
using Pe.Global.Services.Storage;
using Pe.Library.Revit.Ui;
using Pe.Ui.Core;
using Serilog.Events;
using System.Diagnostics;
using System.Windows;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltViews : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            var doc = uiapp.ActiveUIDocument.Document;

            // Build sheet lookup cache once for O(1) lookups
            var sheetCache = new SheetLookupCache(doc);

            // Collect all items
            var items = CollectAllItems(doc, sheetCache);

            // Create preview panel for sidebar
            var previewPanel = new ViewPreviewPanel();

            var actions = new List<PaletteAction<UnifiedViewItem>> {
                new() {
                    Name = "Open",
                    Execute = async item =>  uiapp.OpenAndActivateView(item.View),
                    CanExecute = item => true
                }
            };

            var window = PaletteFactory.Create("View Palette", items, actions,
                new PaletteOptions<UnifiedViewItem> {
                    Storage = new Storage(nameof(CmdPltViews)),
                    PersistenceKey = item => item.View.Id.ToString(),
                    Tabs = [
                        new() { Name = "All", Filter = null, FilterKeySelector = null },
                        new() { Name = "Views", Filter = i => i.ItemType == ViewItemType.View, FilterKeySelector = i => i.TextPill },
                        new() { Name = "Schedules", Filter = i => i.ItemType == ViewItemType.Schedule, FilterKeySelector = i => i.TextPill },
                        new() { Name = "Sheets", Filter = i => i.ItemType == ViewItemType.Sheet, FilterKeySelector = i => i.TextPill }
                    ],
                    DefaultTabIndex = 0,
                    Sidebar = new PaletteSidebar { Content = previewPanel },
                    OnSelectionChangedDebounced = previewPanel.UpdatePreview
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    private static IEnumerable<UnifiedViewItem> CollectAllItems(Document doc, SheetLookupCache sheetCache) {
        var items = new List<UnifiedViewItem>();

        // Collect regular views (excluding templates, schedules, sheets, and system views)
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
            items.Add(new UnifiedViewItem(view, ViewItemType.View, sheetCache));

        // Collect schedules
        var schedules = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSchedule))
            .Cast<ViewSchedule>()
            .Where(s => !s.Name.Contains("<Revision Schedule>"));

        foreach (var schedule in schedules)
            items.Add(new UnifiedViewItem(schedule, ViewItemType.Schedule, sheetCache));

        // Collect sheets
        var sheets = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewSheet))
            .Cast<ViewSheet>();

        foreach (var sheet in sheets)
            items.Add(new UnifiedViewItem(sheet, ViewItemType.Sheet, sheetCache));

        // Sort by primary text
        return items.OrderBy(i => i.TextPrimary);
    }
}
