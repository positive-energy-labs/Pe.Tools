using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.Extensions.FamDocument;
using Pe.Extensions.UiApplication;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Input;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltFamilies : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            var doc = uiapp.ActiveUIDocument.Document;

            // Branch based on document type
            if (doc.IsFamilyDocument)
                return this.ExecuteFamilyDocumentMode(uiapp);
            else
                return this.ExecuteNormalDocumentMode(uiapp);
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    /// <summary>
    ///     Normal document mode: Shows families with actions to browse types, place, edit, and select instances.
    /// </summary>
    private Result ExecuteNormalDocumentMode(UIApplication uiapp) {
        var doc = uiapp.ActiveUIDocument.Document;
        var activeView = uiapp.ActiveUIDocument.ActiveView;

        var items = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .Where(f => !string.IsNullOrWhiteSpace(f.Name))
            .OrderBy(f => f.Name)
            .Select(f => new FamilyPaletteItem(f, doc));

        var actions = new List<PaletteAction<FamilyPaletteItem>> {
            // Default action: Open family types palette (Enter or Click)
            new() {
                Name = "Types",
                Execute = async item => PltFamilyTypes.CreatePalette(uiapp, item.Family).Show(),
                CanExecute = item => item != null
            },
            // Select instances: Open secondary palette to pick specific instance to zoom to
            new() {
                Name = "Select Instances",
                Modifiers = ModifierKeys.Shift,
                Execute = async item => PltFamilyInstances.CreatePalette(uiapp, item.Family).Show(),
                CanExecute = item => {
                    if (item == null) return false;
                    if (!item.Family.IsEditable) return false;

                    // Check if view supports instance placement
                    return !activeView.IsTemplate
                           && activeView.ViewType != ViewType.Legend
                           && activeView.ViewType != ViewType.DrawingSheet
                           && activeView.ViewType != ViewType.DraftingView
                           && activeView.ViewType != ViewType.SystemBrowser
                           && activeView is not ViewSchedule;
                }
            },
            // Open/Edit family
            new() {
                Name = "Open/Edit",
                Modifiers = ModifierKeys.Control,
                Execute = async item => uiapp.OpenAndActivateFamily(item.Family),
                CanExecute = item => item != null && item.Family.IsEditable
            }
        };

        var window = PaletteFactory.Create("Family Palette", items, actions,
            new PaletteOptions<FamilyPaletteItem> {
                Storage = new Storage(nameof(CmdPltFamilies)),
                PersistenceKey = item => item.Family.Id.ToString(),
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                FilterKeySelector = item => item.TextPill
            });
        window.Show();

        return Result.Succeeded;
    }

    /// <summary>
    ///     Family document mode: Shows all family elements (parameters, dimensions, etc.) in tabs.
    /// </summary>
    private Result ExecuteFamilyDocumentMode(UIApplication uiapp) {
        var uidoc = uiapp.ActiveUIDocument;
        var doc = uidoc.Document;
        var familyDoc = new FamilyDocument(doc);

        // Collect all family elements
        var items = CollectFamilyElements(doc, familyDoc).ToList();

        // Create preview panel for sidebar
        var previewPanel = new FamilyElementPreviewPanel(uidoc);

        // Create highlighter for visual feedback
        var highlighter = new ElementHighlighter(uidoc);

        // Create actions based on element type
        var actions = new List<PaletteAction<FamilyElementItem>> {
            // Zoom to element (not available for parameters)
            new() {
                Name = "Zoom to Element",
                Execute = async item => {
                    if (item?.ElementId == null) return;
                    uidoc.ShowElements(item.ElementId);
                    uidoc.Selection.SetElementIds([item.ElementId]);
                },
                CanExecute = item => item?.ElementType != FamilyElementType.Parameter && item?.ElementId != null
            },
            // For nested families: Place in current view
            new() {
                Name = "Place",
                Modifiers = ModifierKeys.Shift,
                Execute = async item => {
                    if (item?.FamilyInstance == null) return;
                    var symbol = item.FamilyInstance.Symbol;
                    try {
                        var trans = new Transaction(doc, $"Place {symbol.FamilyName}");
                        _ = trans.Start();
                        if (!symbol.IsActive) symbol.Activate();
                        _ = trans.Commit();
                        uidoc.PromptForFamilyInstancePlacement(symbol);
                    } catch (Autodesk.Revit.Exceptions.OperationCanceledException) {
                        // User canceled - expected behavior
                    }
                },
                CanExecute = item => item?.ElementType == FamilyElementType.Family
            },
            // For nested families: Open/Edit
            new() {
                Name = "Open/Edit",
                Modifiers = ModifierKeys.Control,
                Execute = async item => {
                    if (item?.FamilyInstance == null) return;
                    var family = item.FamilyInstance.Symbol.Family;
                    uiapp.OpenAndActivateFamily(family);
                },
                CanExecute = item => item?.ElementType == FamilyElementType.Family &&
                                     item.FamilyInstance?.Symbol.Family.IsEditable == true
            }
        };

        var window = PaletteFactory.Create("Family Elements", items, actions,
            new PaletteOptions<FamilyElementItem> {
                Storage = new Storage($"{nameof(CmdPltFamilies)}_FamilyDoc"),
                PersistenceKey = item => item.PersistenceKey,
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                FilterKeySelector = item => item.TextPill,
                Tabs = [
                    new TabDefinition<FamilyElementItem> {
                        Name = "All",
                        Filter = null,
                        FilterKeySelector = i => i.TextPill
                    },
                    new TabDefinition<FamilyElementItem> {
                        Name = "Families",
                        Filter = i => i.ElementType == FamilyElementType.Family,
                        FilterKeySelector = i => i.TextPill
                    },
                    new TabDefinition<FamilyElementItem> {
                        Name = "Params",
                        Filter = i => i.ElementType == FamilyElementType.Parameter,
                        FilterKeySelector = i => i.TextPill
                    },
                    new TabDefinition<FamilyElementItem> {
                        Name = "Dims",
                        Filter = i => i.ElementType == FamilyElementType.Dimension,
                        FilterKeySelector = null
                    },
                    new TabDefinition<FamilyElementItem> {
                        Name = "Ref Planes",
                        Filter = i => i.ElementType == FamilyElementType.ReferencePlane,
                        FilterKeySelector = null
                    },
                    new TabDefinition<FamilyElementItem> {
                        Name = "Connectors",
                        Filter = i => i.ElementType == FamilyElementType.Connector,
                        FilterKeySelector = null
                    }
                ],
                DefaultTabIndex = 0,
                Sidebar = new PaletteSidebar { Content = previewPanel },
                OnSelectionChanged = item => {
                    if (item?.ElementId != null)
                        highlighter.Highlight(item.ElementId);
                },
                OnSelectionChangedDebounced = previewPanel.UpdatePreview
            });

        window.Closed += (_, _) => highlighter.Dispose();
        window.Show();

        return Result.Succeeded;
    }

    private static IEnumerable<FamilyElementItem> CollectFamilyElements(Document doc, FamilyDocument familyDoc) {
        // Nested Families
        foreach (var instance in new FilteredElementCollector(doc).OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>())
            yield return new FamilyElementItem(instance, familyDoc);

        // Family Parameters
        foreach (var param in familyDoc.FamilyManager.Parameters.OfType<FamilyParameter>()
                     .OrderBy(p => p.Definition.Name))
            yield return new FamilyElementItem(param, familyDoc);

        // Dimensions (excluding SpotDimensions)
        foreach (var dim in new FilteredElementCollector(doc).OfClass(typeof(Dimension)).Cast<Dimension>()
                     .Where(d => d is not SpotDimension))
            yield return new FamilyElementItem(dim, familyDoc);

        // Reference Planes
        foreach (var refPlane in new FilteredElementCollector(doc).OfClass(typeof(ReferencePlane))
                     .Cast<ReferencePlane>())
            yield return new FamilyElementItem(refPlane, familyDoc);

        // Connectors
        foreach (var connector in new FilteredElementCollector(doc).OfClass(typeof(ConnectorElement))
                     .Cast<ConnectorElement>())
            yield return new FamilyElementItem(connector, familyDoc);
    }
}

/// <summary>
///     Adapter that wraps Revit Family to implement IPaletteListItem (for normal documents).
/// </summary>
public class FamilyPaletteItem : IPaletteListItem {
    private readonly Document _doc;

    public FamilyPaletteItem(Family family, Document doc) {
        this.Family = family;
        this._doc = doc;
    }

    /// <summary> Access to underlying family </summary>
    public Family Family { get; }

    public string TextPrimary => this.Family.Name;

    public string TextSecondary {
        get {
            // Get list of family type names
            var symbolIds = this.Family.GetFamilySymbolIds();
            var typeNames = symbolIds
                .Select(this._doc.GetElement)
                .OfType<FamilySymbol>()
                .Select(symbol => symbol.Name)
                .OrderBy(name => name)
                .ToList();

            return string.Join(", ", typeNames);
        }
    }

    public string TextPill => this.Family.FamilyCategory?.Name ?? string.Empty;

    public Func<string> GetTextInfo => () =>
        $"{this.Family.Name}\nCategory: {this.Family.FamilyCategory?.Name}\nId: {this.Family.Id}";

    public BitmapImage? Icon => null;
    public Color? ItemColor => null;
}
