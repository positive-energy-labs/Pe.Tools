using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Services;
using Pe.Extensions.UiApplication;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Base class for all view palette commands.
///     Contains shared logic for building and showing the palette.
///     Derived classes only need to specify the default tab index.
/// </summary>
[Transaction(TransactionMode.Manual)]
public abstract class ViewPaletteBase : IExternalCommand {
    /// <summary>
    ///     Override to specify which tab should be selected by default.
    /// </summary>
    protected abstract int DefaultTabIndex { get; }

    /// <summary>
    ///     Override to specify the storage key for persistence.
    ///     Each command gets its own usage tracking.
    /// </summary>
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
                    Execute = async item => uiapp.OpenAndActivateView(item.View),
                    CanExecute = item => true
                },
                new() {
                    Name = "Snoop",
                    Modifiers = System.Windows.Input.ModifierKeys.Alt,
                    Execute = async item => {
                        var title = item.ItemType switch {
                            ViewItemType.View => $"View: {item.View.Name}",
                            ViewItemType.Schedule => $"Schedule: {item.View.Name}",
                            ViewItemType.Sheet => $"Sheet: {item.View.Name}",
                            _ => item.View.Name
                        };
                        _ = RevitDbExplorerService.TrySnoopObject(uiapp, doc, item.View, title);
                    },
                    CanExecute = item => item != null
                }
            };

            var window = PaletteFactory.Create("View Palette", items, actions,
                new PaletteOptions<UnifiedViewItem> {
                    Persistence = (new Storage(nameof(CmdPltViews)), item => item.View.Id.ToString()),
                    Tabs = [
                        new TabDefinition<UnifiedViewItem> { Name = "All", Filter = null, FilterKeySelector = null },
                        new TabDefinition<UnifiedViewItem> {
                            Name = "Views",
                            Filter = i => i.ItemType == ViewItemType.View,
                            FilterKeySelector = i => i.TextPill
                        },
                        new TabDefinition<UnifiedViewItem> {
                            Name = "Schedules",
                            Filter = i => i.ItemType == ViewItemType.Schedule,
                            FilterKeySelector = i => i.TextPill
                        },
                        new TabDefinition<UnifiedViewItem> {
                            Name = "Sheets",
                            Filter = i => i.ItemType == ViewItemType.Sheet,
                            FilterKeySelector = i => i.TextPill
                        }
                    ],
                    DefaultTabIndex = this.DefaultTabIndex,
                    SidebarPanel = previewPanel
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
