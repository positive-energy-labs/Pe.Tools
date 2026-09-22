using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Global.Ui;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.StorageRuntime;
using Serilog.Events;
using System.Diagnostics;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Base class for all Go palette commands — the unified "go to a thing" palette
///     (views, schedules, sheets, and family-type placement).
///     Derived classes only need to specify the default tab index.
/// </summary>
[Transaction(TransactionMode.Manual)]
public abstract class ViewPaletteBase : IExternalCommand {
    internal const string Title = "Go";

    /// <summary>
    ///     Override to specify which tab should be selected by default.
    /// </summary>
    protected abstract int DefaultTabIndex { get; }

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        // Docked Go pane: the ribbon shortcut summons + focuses it.
        if (PaletteDock.TrySummonDocked(Title))
            return Result.Succeeded;

        return ShowPalette(this.DefaultTabIndex);
    }

    /// <summary>
    ///     Opens the Go palette on a tab, optionally pre-filtered (e.g. Place tab scoped
    ///     to one family — the Families -&gt; "Show Types" flow).
    /// </summary>
    internal static Result ShowPalette(int defaultTabIndex, string? filterValue = null) {
        try {
            var uiapp = RevitUiSession.CurrentUIApplication;
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;

            // Build sheet lookup cache once for O(1) lookups
            var sheetCache = new SheetLookupCache(doc);

            // Type-dispatching preview panel (views vs family types)
            var previewPanel = new GoPreviewPanel(doc);

            // Create tab definitions with lazy loading
            var tabs = ViewTabConfig.CreateTabs(doc, uiapp, uidoc, sheetCache);

            var window = PaletteFactory.Create(Title,
                new PaletteOptions<IPaletteListItem> {
                    // Secondary at full weight: on Place items it's the family name, which
                    // carries as much intent as the type name ("ao smith" -> HPTS-50).
                    SearchConfig = new SearchConfig {
                        SearchFields = SearchFields.TextPrimary | SearchFields.TextSecondary,
                        FieldWeights = new SearchFieldWeights { Secondary = 1.0 }
                    },
                    Persistence = (StorageClient.Default.Module(nameof(CmdPltViews)), item => item switch {
                        UnifiedViewItem view => view.View.Id.ToString(),
                        FamilyPalette.UnifiedFamilyItem family => family.PersistenceKey,
                        _ => item.TextPrimary
                    }),
                    Tabs = tabs,
                    DefaultTabIndex = defaultTabIndex,
                    SidebarPanel = previewPanel,
                    ViewModelMutator = vm => {
                        if (string.IsNullOrWhiteSpace(filterValue)) return;
                        vm.SelectedFilterValue = filterValue!;
                        if (vm.FilteredItems.Count > 0)
                            vm.SelectedIndex = 0;
                    }
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}
