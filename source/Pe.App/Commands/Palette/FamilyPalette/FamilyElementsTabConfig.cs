using Pe.Extensions.FamDocument;
using Pe.Ui.Core;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Static configuration class defining all tab definitions for the Family Elements palette.
///     Each tab specifies its own ItemProvider for lazy loading and per-tab actions.
/// </summary>
internal static class FamilyElementsTabConfig {
    /// <summary>
    ///     Creates the tab definitions for the Family Elements palette.
    /// </summary>
    internal static List<TabDefinition<FamilyElementItem>> CreateTabs(
        FamilyDocument familyDoc
    ) => [
        new() {
            Name = "All",
            ItemProvider = () => FamilyElementsActions.CollectAllElements(familyDoc),
            FilterKeySelector = i => i.TextPill,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Zoom to Element",
                    Execute = async item => FamilyElementsActions.HandleZoomToElement(item),
                    CanExecute = item => item?.ElementType != FamilyElementType.Parameter && item?.ElementId != null
                },
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        },
        new() {
            Name = "Families",
            ItemProvider = () => FamilyElementsActions.CollectFamilies(familyDoc),
            FilterKeySelector = i => i.TextPill,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Zoom to Element",
                    Execute = async item => FamilyElementsActions.HandleZoomToElement(item),
                    CanExecute = item => item?.ElementId != null
                },
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        },
        new() {
            Name = "Params",
            ItemProvider = () => FamilyElementsActions.CollectParameters(familyDoc),
            FilterKeySelector = i => i.TextPill,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        },
        new() {
            Name = "Dims",
            ItemProvider = () => FamilyElementsActions.CollectDimensions(familyDoc),
            FilterKeySelector = null,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Zoom to Element",
                    Execute = async item => FamilyElementsActions.HandleZoomToElement(item),
                    CanExecute = item => item?.ElementId != null
                },
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        },
        new() {
            Name = "Ref Planes",
            ItemProvider = () => FamilyElementsActions.CollectReferencePlanes(familyDoc),
            FilterKeySelector = null,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Zoom to Element",
                    Execute = async item => FamilyElementsActions.HandleZoomToElement(item),
                    CanExecute = item => item?.ElementId != null
                },
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        },
        new() {
            Name = "Connectors",
            ItemProvider = () => FamilyElementsActions.CollectConnectors(familyDoc),
            FilterKeySelector = null,
            Actions = [
                new PaletteAction<FamilyElementItem> {
                    Name = "Zoom to Element",
                    Execute = async item => FamilyElementsActions.HandleZoomToElement(item),
                    CanExecute = item => item?.ElementId != null
                },
                new PaletteAction<FamilyElementItem> {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => FamilyElementsActions.HandleSnoop(item)
                }
            ]
        }
    ];
}