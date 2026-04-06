using Autodesk.Revit.UI;
using Pe.Revit.Ui.Core;
using System.Threading.Tasks;
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
            new("Families", () => FamilyActions.CollectFamilies(doc, uidoc, instancesOptions),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Family Types",
                    Execute = item => {
                        _ = FamilyPaletteBase.ShowPalette(1, item?.Family?.Name);
                        return Task.CompletedTask;
                    }
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Place Types",
                    Execute = item => {
                        var family = item?.Family;
                        if (family == null) return Task.CompletedTask;
                        FamilyPlacementHelper.ShowPlacementPaletteForFamily(family);
                        return Task.CompletedTask;
                    },
                    CanExecute = item => item?.Family != null && FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                OpenAndEditAction(),
                SnoopAction(doc)
            ) {
                FilterKeySelector = i => i.TextPill
            },
            new("Family Types", () => FamilyActions.CollectFamilyTypes(doc, uidoc, instancesOptions),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Place",
                    Execute = item => {
                        FamilyActions.HandlePlace(doc, uidoc, item);
                        return Task.CompletedTask;
                    },
                    CanExecute = item => item != null && FamilyActions.CanPlaceInView(uidoc.ActiveView)
                },
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Inspect Instances",
                    Execute = item => {
                        _ = FamilyPaletteBase.ShowPalette(2, item?.GetFamilySymbol()?.Name);
                        return Task.CompletedTask;
                    }
                },
                OpenAndEditAction(),
                SnoopAction(doc)
            ) {
                FilterKeySelector = i => i.TextSecondary
            },
            new("Family Instances", () => FamilyActions.CollectFamilyInstances(doc, uidoc, instancesOptions),
                new PaletteAction<UnifiedFamilyItem> {
                    Name = "Zoom To",
                    Execute = item => {
                        FamilyActions.HandleZoomToFamilyInstance(item);
                        return Task.CompletedTask;
                    }
                },
                OpenAndEditAction(),
                SnoopAction(doc)
            ) {
                FilterKeySelector = i => i.TextPrimary
            }
        };

        return (tabs, instancesOptions);
    }

    private static PaletteAction<UnifiedFamilyItem> OpenAndEditAction() =>
        new PaletteAction<UnifiedFamilyItem> {
            Name = "Open/Edit",
            Modifiers = ModifierKeys.Control,
            Execute = item => {
                FamilyActions.HandleOpenEditFamily(item);
                return Task.CompletedTask;
            },
            CanExecute = item => item?.GetFamily()?.IsEditable == true
        };

    private static PaletteAction<UnifiedFamilyItem> SnoopAction(Document doc) =>
        new PaletteAction<UnifiedFamilyItem> {
            Name = "Snoop",
            Modifiers = ModifierKeys.Alt,
            Execute = item => {
                FamilyActions.HandleSnoop(doc, item);
                return Task.CompletedTask;
            }
        };

}