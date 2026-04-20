using Pe.Revit.Extensions.FamDocument;
using Pe.Revit.Ui.Core;
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
        new(
            "All",
            () => FamilyElementsActions.CollectAllElements(familyDoc),
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
        ) { FilterKeySelector = i => i.TextPill },
        new(
            "Families",
            () => FamilyElementsActions.CollectFamilies(familyDoc),
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
        ) { FilterKeySelector = i => i.TextPill },
        new(
            "Params",
            () => FamilyElementsActions.CollectParameters(familyDoc),
            new PaletteAction<FamilyElementItem> {
                Name = "Snoop",
                Modifiers = ModifierKeys.Alt,
                Execute = async item => FamilyElementsActions.HandleSnoop(item)
            }
        ) { FilterKeySelector = i => i.TextPill },
        new(
            "Dims",
            () => FamilyElementsActions.CollectDimensions(familyDoc),
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
        ),
        new(
            "Ref Planes",
            () => FamilyElementsActions.CollectReferencePlanes(familyDoc),
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
        ),
        new(
            "Connectors",
            () => FamilyElementsActions.CollectConnectors(familyDoc),
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
        )
    ];
}