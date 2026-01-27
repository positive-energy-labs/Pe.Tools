using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.FamilyPalette;
using Pe.App.Services;
using Pe.Extensions.FamDocument;
using Pe.Extensions.UiApplication;
using Pe.Global.PolyFill;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Input;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Shows all family elements (parameters, dimensions, etc.) in a family document.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdPltFamilyElements : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            return ShowPalette(commandData.Application);
        } catch (Exception ex) {
            Log.Error(ex, "Family elements palette command failed");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    internal static Result ShowPalette(UIApplication uiapp) {
        try {
            var uidoc = uiapp.ActiveUIDocument;
            var doc = uidoc.Document;
            if (!doc.IsFamilyDocument) {
                TaskDialog.Show("Family Elements", "Family Elements palette is only available in family documents.");
                return Result.Cancelled;
            }

            var familyDoc = new FamilyDocument(doc);

            // Collect all family elements
            var items = CollectFamilyElements(doc, familyDoc).ToList();

            // Create preview panel for sidebar
            var previewPanel = new FamilyElementPreviewPanel(uidoc);

            // Create highlighter for visual feedback
            var highlighter = new ElementHighlighter(uidoc);

            // Create actions based on element type
            var actions = new List<PaletteAction<FamilyElementItem>> {
                new() {
                    Name = "Zoom to Element",
                    Execute = async item => {
                        if (item?.ElementId == null) return;
                        uidoc.ShowElements(item.ElementId);
                        uidoc.Selection.SetElementIds([item.ElementId]);
                    },
                    CanExecute = item => item?.ElementType != FamilyElementType.Parameter && item?.ElementId != null
                },
                new() {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => {
                        object objectToSnoop = item.ElementType switch {
                            FamilyElementType.Parameter => item.FamilyParam!,
                            FamilyElementType.Connector => item.Connector!,
                            FamilyElementType.Dimension => item.Dimension!,
                            FamilyElementType.ReferencePlane => item.RefPlane!,
                            FamilyElementType.Family => item.FamilyInstance!,
                            _ => throw new InvalidOperationException($"Unknown element type: {item.ElementType}")
                        };
                        _ = RevitDbExplorerService.TrySnoopObject(uiApp: uiapp, doc, objectToSnoop, item.TextPrimary);
                    },
                    CanExecute = item => item != null
                }
            };

            var window = PaletteFactory.Create("Family Elements", items, actions,
                new PaletteOptions<FamilyElementItem> {
                    Storage = new Storage(nameof(CmdPltFamilyElements)),
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
                    SidebarPanel = previewPanel,
                    OnSelectionChanged = item => {
                        if (item?.ElementId != null)
                            highlighter.Highlight(item.ElementId);
                    }
                });

            window.Closed += (_, _) => highlighter.Dispose();
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Family elements palette failed to open");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
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
