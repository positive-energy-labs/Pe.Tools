using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Extensions.FamDocument;
using Pe.Extensions.UiApplication;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Base class for all family elements palette commands.
///     Contains shared logic for building and showing the palette.
///     Derived classes only need to specify the default tab index.
/// </summary>
[Transaction(TransactionMode.Manual)]
public abstract class FamilyElementsPaletteBase : IExternalCommand {
    /// <summary>
    ///     Override to specify which tab should be selected by default.
    /// </summary>
    protected abstract int DefaultTabIndex { get; }

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            return ShowPalette(commandData.Application, this.DefaultTabIndex);
        } catch (Exception ex) {
            Log.Error(ex, "Family elements palette command failed");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    internal static Result ShowPalette(UIApplication uiapp, int defaultTabIndex) {
        try {
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            if (!doc.IsFamilyDocument) {
                _ = TaskDialog.Show("Family Elements", "Family Elements palette is only available in family documents.");
                return Result.Cancelled;
            }

            var familyDoc = new FamilyDocument(doc);

            // Create preview panel for sidebar
            var previewPanel = new FamilyElementPreviewPanel(uidoc);

            // Create highlighter for visual feedback
            var highlighter = new ElementHighlighter(uidoc);

            // Create tab definitions with lazy loading
            var tabs = FamilyElementsTabConfig.CreateTabs(doc, uiapp, uidoc, familyDoc);

            var window = PaletteFactory.Create("Family Elements",
                new PaletteOptions<FamilyElementItem> {
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = tabs,
                    DefaultTabIndex = defaultTabIndex,
                    SidebarPanel = previewPanel,
                    OnSelectionChanged = item => {
                        if (item?.ElementId != null)
                            highlighter.Highlight(item.ElementId);
                    }
                });

            window.Closed += (_, _) => highlighter.Dispose();
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Family elements palette failed to open");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}
