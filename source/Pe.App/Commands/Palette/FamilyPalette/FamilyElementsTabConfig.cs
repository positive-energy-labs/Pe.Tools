using Autodesk.Revit.UI;
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
        Document doc,
        UIApplication uiapp,
        UIDocument uidoc,
        FamilyDocument familyDoc
    ) => [
            new TabDefinition<FamilyElementItem> {
                Name = "All",
                ItemProvider = () => FamilyElementsActions.CollectAllElements(doc, familyDoc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Zoom to Element",
                        Execute = async item => FamilyElementsActions.HandleZoomToElement(uidoc, item),
                        CanExecute = item => item?.ElementType != FamilyElementType.Parameter && item?.ElementId != null
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<FamilyElementItem> {
                Name = "Families",
                ItemProvider = () => FamilyElementsActions.CollectFamilies(doc, familyDoc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Zoom to Element",
                        Execute = async item => FamilyElementsActions.HandleZoomToElement(uidoc, item),
                        CanExecute = item => item?.ElementId != null
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<FamilyElementItem> {
                Name = "Params",
                ItemProvider = () => FamilyElementsActions.CollectParameters(doc, familyDoc),
                FilterKeySelector = i => i.TextPill,
                Actions = [
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<FamilyElementItem> {
                Name = "Dims",
                ItemProvider = () => FamilyElementsActions.CollectDimensions(doc, familyDoc),
                FilterKeySelector = null,
                Actions = [
                    new() {
                        Name = "Zoom to Element",
                        Execute = async item => FamilyElementsActions.HandleZoomToElement(uidoc, item),
                        CanExecute = item => item?.ElementId != null
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<FamilyElementItem> {
                Name = "Ref Planes",
                ItemProvider = () => FamilyElementsActions.CollectReferencePlanes(doc, familyDoc),
                FilterKeySelector = null,
                Actions = [
                    new() {
                        Name = "Zoom to Element",
                        Execute = async item => FamilyElementsActions.HandleZoomToElement(uidoc, item),
                        CanExecute = item => item?.ElementId != null
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            },
            new TabDefinition<FamilyElementItem> {
                Name = "Connectors",
                ItemProvider = () => FamilyElementsActions.CollectConnectors(doc, familyDoc),
                FilterKeySelector = null,
                Actions = [
                    new() {
                        Name = "Zoom to Element",
                        Execute = async item => FamilyElementsActions.HandleZoomToElement(uidoc, item),
                        CanExecute = item => item?.ElementId != null
                    },
                    new() {
                        Name = "Snoop",
                        Modifiers = ModifierKeys.Alt,
                        Execute = async item => FamilyElementsActions.HandleSnoop(uiapp, doc, item),
                        CanExecute = item => item != null
                    }
                ]
            }
        ];
}
