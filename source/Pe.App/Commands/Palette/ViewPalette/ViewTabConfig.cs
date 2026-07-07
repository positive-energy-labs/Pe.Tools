using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.Revit.Ui.Core;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.ViewPalette;

/// <summary>
///     Static configuration class defining all tab definitions for the Go palette.
///     Tabs are type-erased over <see cref="IPaletteListItem" /> so navigation targets
///     (views) and placement targets (family types) coexist; actions cast per tab.
/// </summary>
internal static class ViewTabConfig {
    /// <summary>
    ///     Creates the tab definitions for the Go palette.
    /// </summary>
    internal static List<TabDefinition<IPaletteListItem>> CreateTabs(
        Document doc,
        UIApplication uiapp,
        UIDocument uidoc,
        SheetLookupCache sheetCache
    ) {
        // Define actions once (same for all view tabs)
        var viewActions = new List<PaletteAction<IPaletteListItem>> {
            new() {
                Name = "Open",
                Execute = async item => {
                    if (item is UnifiedViewItem view) ViewActions.HandleOpen(uiapp, view);
                },
                CanExecute = item => item is UnifiedViewItem
            },
            new() {
                Name = "Snoop",
                Modifiers = ModifierKeys.Alt,
                Execute = async item => {
                    if (item is UnifiedViewItem view) ViewActions.HandleSnoop(doc, view);
                }
            }
        };

        // Place tab reuses the family palette's collectors/actions with default options —
        // the full Family palette (tray, instance filters) stays available for dev work.
        var placeOptions = new FamilyInstancesOptions();

        return [
            new TabDefinition<IPaletteListItem>(
                "All",
                () => ViewActions.CollectAllViews(doc, sheetCache),
                viewActions
            ),
            new TabDefinition<IPaletteListItem>(
                "Views",
                () => ViewActions.CollectViews(doc, sheetCache),
                viewActions
            ) { FilterKeySelector = i => i.TextPill ?? string.Empty },
            new TabDefinition<IPaletteListItem>(
                "Schedules",
                () => ViewActions.CollectSchedules(doc, sheetCache),
                viewActions
            ) {
                FilterKeySelector = i => i.TextPill ?? string.Empty
                //TODO: add "Place on Sheet" and "Open Sheets" actions, see UIDocument.CanPlaceElementType and UIDocument.PostRequestForElementTypePlacement
            },
            new TabDefinition<IPaletteListItem>(
                "Sheets",
                () => ViewActions.CollectSheets(doc, sheetCache),
                viewActions
            ) { FilterKeySelector = i => i.TextPill ?? string.Empty },
            new TabDefinition<IPaletteListItem>(
                "Families",
                () => FamilyActions.CollectFamilies(doc, uidoc, placeOptions),
                new PaletteAction<IPaletteListItem> {
                    Name = "Show Types",
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family)
                            _ = ViewPaletteBase.ShowPalette(5, family.Family?.Name);
                    }
                },
                new PaletteAction<IPaletteListItem> {
                    Name = "Place Types",
                    Execute = async item => {
                        if ((item as UnifiedFamilyItem)?.Family is { } family)
                            FamilyPlacementHelper.ShowPlacementPaletteForFamily(family);
                    },
                    CanExecute = item => (item as UnifiedFamilyItem)?.Family != null &&
                                         FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                new PaletteAction<IPaletteListItem> {
                    Name = "Open/Edit",
                    Modifiers = ModifierKeys.Control,
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family) FamilyActions.HandleOpenEditFamily(family);
                    },
                    CanExecute = item => (item as UnifiedFamilyItem)?.GetFamily()?.IsEditable == true
                },
                new PaletteAction<IPaletteListItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family) FamilyActions.HandleSnoop(doc, family);
                    }
                }
            ) { FilterKeySelector = i => i.TextPill ?? string.Empty },
            new TabDefinition<IPaletteListItem>(
                "Place",
                () => FamilyActions.CollectFamilyTypes(doc, uidoc, placeOptions),
                new PaletteAction<IPaletteListItem> {
                    Name = "Place",
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family) FamilyActions.HandlePlace(doc, uidoc, family);
                    },
                    CanExecute = item => item is UnifiedFamilyItem &&
                                         FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                new PaletteAction<IPaletteListItem> {
                    Name = "Open/Edit",
                    Modifiers = ModifierKeys.Control,
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family) FamilyActions.HandleOpenEditFamily(family);
                    },
                    CanExecute = item => (item as UnifiedFamilyItem)?.GetFamily()?.IsEditable == true
                },
                new PaletteAction<IPaletteListItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => {
                        if (item is UnifiedFamilyItem family) FamilyActions.HandleSnoop(doc, family);
                    }
                }
            ) { FilterKeySelector = i => i.TextSecondary }
        ];
    }
}
