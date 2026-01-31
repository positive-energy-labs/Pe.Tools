using Autodesk.Revit.UI;
using Pe.Ui.Core;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static configuration class defining all tab definitions for the Family palette.
///     Each tab specifies its own ItemProvider for lazy loading and per-tab actions.
/// </summary>
internal static class FamilyTabConfig {
    /// <summary>
    ///     Creates the tab definitions for the Family palette.
    /// </summary>
    internal static List<TabDefinition<UnifiedFamilyItem>> CreateTabs(
        Document doc,
        UIApplication uiapp,
        UIDocument uidoc
    ) => [
            new TabDefinition<UnifiedFamilyItem> {
                Name = "Families",
                ItemProvider = () => FamilyActions.CollectFamilies(doc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Family Types",
                        Execute = async item => FamilyPaletteBase.ShowPalette(uiapp, defaultTabIndex: 1, filterValue: item?.Family?.Name)
                    },
                    new() {
                        Name = "Open/Edit",
                        Modifiers = ModifierKeys.Control,
                        Execute = async item => FamilyActions.HandleOpenEditFamily(uiapp, item),
                        CanExecute = item => item != null && item.GetFamily()?.IsEditable == true
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<UnifiedFamilyItem> {
                Name = "Family Types",
                ItemProvider = () => FamilyActions.CollectFamilyTypes(doc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Place",
                        Execute = async item => FamilyActions.HandlePlace(doc, uidoc, item),
                        CanExecute = item => item != null && FamilyActions.CanPlaceInView(uidoc.ActiveView)
                    },
                    new() {
                        Name = "Open/Edit",
                        Modifiers = ModifierKeys.Control,
                        Execute = async item => FamilyActions.HandleOpenEditFamilyType(uiapp, item),
                        CanExecute = item => item != null && item.GetFamily()?.IsEditable == true
                    },
                    new() {
                        Name = "Inspect Instances",
                        Execute = async item => FamilyPaletteBase.ShowPalette(uiapp, defaultTabIndex: 2, filterValue: item?.FamilySymbol?.Name)
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<UnifiedFamilyItem> {
                Name = "Family Instances",
                ItemProvider = () => FamilyActions.CollectFamilyInstances(doc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            }
        ];
}
