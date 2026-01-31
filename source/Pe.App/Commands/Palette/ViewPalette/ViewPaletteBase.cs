using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
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

            // Create preview panel for sidebar
            var previewPanel = new ViewPreviewPanel();

            // Create tab definitions with lazy loading
            var tabs = ViewTabConfig.CreateTabs(doc, uiapp, sheetCache);

            var window = PaletteFactory.Create("View Palette",
                new PaletteOptions<UnifiedViewItem> {
                    Persistence = (new Storage(nameof(CmdPltViews)), item => item.View.Id.ToString()),
                    Tabs = tabs,
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
}
