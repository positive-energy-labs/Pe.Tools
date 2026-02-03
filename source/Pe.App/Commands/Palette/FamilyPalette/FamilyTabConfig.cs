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
    internal static (List<TabDefinition<UnifiedFamilyItem>> Tabs, FamilyInstancesOptions? InstancesOptions) CreateTabs(
        Document doc,
        UIDocument uidoc
    ) {
        // Create options for Family Instances tab
        var instancesOptions = new FamilyInstancesOptions();
        var tabs = new List<TabDefinition<UnifiedFamilyItem>> {
            new("Families", () => FamilyActions.CollectFamilies(doc),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Family Types",
                    Execute = async item => FamilyPaletteBase.ShowPalette(1, item?.Family?.Name)
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Open/Edit",
                    Modifiers = ModifierKeys.Control,
                    Execute = async item => FamilyActions.HandleOpenEditFamily(item),
                    CanExecute = item => item?.GetFamily()?.IsEditable == true
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Place Types",
                    Execute = async item => FamilyPlacementHelper.ShowPlacementPaletteForFamily(item?.Family),
                    CanExecute = item => item?.Family != null && FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyActions.HandleSnoop(doc, item)
                }
            ) {
                FilterKeySelector = i => i.TextPill
            },
            new("Family Types", () => FamilyActions.CollectFamilyTypes(doc),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Place",
                    Execute = async item => FamilyActions.HandlePlace(doc, uidoc, item),
                    CanExecute = item => item != null && FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Open/Edit",
                    Modifiers = ModifierKeys.Control,
                    Execute = async item => FamilyActions.HandleOpenEditFamilyType(item),
                    CanExecute = item => item?.GetFamily()?.IsEditable == true
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Inspect Instances",
                    Execute = async item => FamilyPaletteBase.ShowPalette(2, item?.FamilySymbol?.Name)
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyActions.HandleSnoop(doc, item)
                }
            ) {
                FilterKeySelector = i => i.TextPill
            },
            new("Family Instances", () => FamilyActions.CollectFamilyInstances(doc, uidoc, instancesOptions),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyActions.HandleSnoop(doc, item)
                }
            ) {
                FilterKeySelector = i => i.TextPill
            }
        };

        return (tabs, instancesOptions);
    }
}