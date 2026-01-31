using Autodesk.Revit.UI;
using Pe.Ui.Core;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Static configuration class defining all tab definitions for the View palette.
///     Each tab specifies its own ItemProvider for lazy loading.
/// </summary>
internal static class ViewTabConfig {
    /// <summary>
    ///     Creates the tab definitions for the View palette.
    /// </summary>
    internal static List<TabDefinition<UnifiedViewItem>> CreateTabs(
        Document doc,
        UIApplication uiapp,
        SheetLookupCache sheetCache
    ) {
        // Define actions once (same for all tabs)
        var commonActions = new List<PaletteAction<UnifiedViewItem>> {
            new() {
                Name = "Open",
                Execute = async item => ViewActions.HandleOpen(uiapp, item),
                CanExecute = item => true
            },
            new() {
                Name = "Snoop",
                Modifiers = ModifierKeys.Alt,
                Execute = async item => ViewActions.HandleSnoop(uiapp, doc, item),
                CanExecute = item => item != null
            }
        };

        return [
            new TabDefinition<UnifiedViewItem> {
                Name = "All",
                ItemProvider = () => ViewActions.CollectAllViews(doc, sheetCache),
                FilterKeySelector = null,
                Actions = commonActions
            },
            new TabDefinition<UnifiedViewItem> {
                Name = "Views",
                ItemProvider = () => ViewActions.CollectViews(doc, sheetCache),
                FilterKeySelector = i => i.TextPill,
                Actions = commonActions
            },
            new TabDefinition<UnifiedViewItem> {
                Name = "Schedules",
                ItemProvider = () => ViewActions.CollectSchedules(doc, sheetCache),
                FilterKeySelector = i => i.TextPill,
                Actions = commonActions //TODO: add "Place on Sheet" and "Open Sheets" actions, see UIDocument.CanPlaceElementType and UIDocument.PostRequestForElementTypePlacement
            },
            new TabDefinition<UnifiedViewItem> {
                Name = "Sheets",
                ItemProvider = () => ViewActions.CollectSheets(doc, sheetCache),
                FilterKeySelector = i => i.TextPill,
                Actions = commonActions
            }
        ];
    }
}
