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
                Name = "Open", Execute = async item => ViewActions.HandleOpen(uiapp, item), CanExecute = item => true
            },
            new() {
                Name = "Snoop", Modifiers = ModifierKeys.Alt, Execute = async item => ViewActions.HandleSnoop(doc, item)
            }
        };

        return [
            new TabDefinition<UnifiedViewItem>(
                "All",
                () => ViewActions.CollectAllViews(doc, sheetCache),
                commonActions
            ),
            new TabDefinition<UnifiedViewItem>(
                "Views",
                () => ViewActions.CollectViews(doc, sheetCache),
                commonActions
            ) {
                FilterKeySelector = i => i.TextPill
            },
            new TabDefinition<UnifiedViewItem>(
                "Schedules",
                () => ViewActions.CollectSchedules(doc, sheetCache),
                commonActions
            ) {
                FilterKeySelector = i => i.TextPill
                //TODO: add "Place on Sheet" and "Open Sheets" actions, see UIDocument.CanPlaceElementType and UIDocument.PostRequestForElementTypePlacement
            },
            new TabDefinition<UnifiedViewItem>(
                "Sheets",
                () => ViewActions.CollectSheets(doc, sheetCache),
                commonActions
            ) {
                FilterKeySelector = i => i.TextPill
            }
        ];
    }
}