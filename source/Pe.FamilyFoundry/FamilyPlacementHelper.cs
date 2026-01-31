using Autodesk.Revit.DB.Structure;
using Autodesk.Revit.UI;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;

namespace Pe.FamilyFoundry;

/// <summary>
///     Helper for placing processed families in a view for testing purposes.
/// </summary>
public static class FamilyPlacementHelper {
    /// <summary>
    ///     Shows a palette with buttons to interactively place each processed family.
    /// </summary>
    /// <param name="uiApp">The UI application</param>
    /// <param name="familyNames">List of family names that were processed</param>
    /// <param name="commandName">Name of the command for dialog title</param>
    public static void PromptAndPlaceFamilies(UIApplication uiApp, List<string> familyNames, string commandName) {
        if (familyNames == null || familyNames.Count == 0)
            return;

        var activeView = uiApp.ActiveUIDocument.ActiveView;

        // Check if active view is valid for placing families
        if (activeView.IsTemplate
            || activeView.ViewType == ViewType.Legend
            || activeView.ViewType == ViewType.DrawingSheet
            || activeView.ViewType == ViewType.DraftingView
            || activeView.ViewType == ViewType.SystemBrowser
            || activeView is ViewSchedule) {
            _ = TaskDialog.Show("Invalid View",
                "The current active view is not valid for placing families.\n\n" +
                "Please switch to a floor plan, ceiling plan, or 3D view first.");
            return;
        }

        // Create palette with placement buttons
        ShowFamilyPlacementPalette(uiApp, familyNames, commandName);
    }

    /// <summary>
    ///     Shows a palette with buttons to place each family interactively.
    /// </summary>
    private static void ShowFamilyPlacementPalette(UIApplication uiApp, List<string> familyNames, string commandName) {
        var doc = uiApp.ActiveUIDocument.Document;
        // doc.Regenerate();
        // Create palette items for each family
        // Get all families in the document first
        var allFamilies = new FilteredElementCollector(doc)
            .OfClass(typeof(Family))
            .Cast<Family>()
            .ToList();

        var items = familyNames
            .Select(name => {
                // Remove .rfa extension if present
                var nameWithoutExtension = name.EndsWith(".rfa", StringComparison.OrdinalIgnoreCase)
                    ? name[..^4]
                    : name;

                // Try to find family by exact match first, then by name without extension
                var family = allFamilies.FirstOrDefault(f => f.Name == name)
                             ?? allFamilies.FirstOrDefault(f => f.Name == nameWithoutExtension);

                return family != null ? new FamilyPlacementItem(family) : null;
            })
            .Where(item => item != null)
            .Cast<FamilyPlacementItem>()
            .ToList();

        if (items.Count == 0) {
            _ = TaskDialog.Show("No Families Found",
                "None of the processed families could be found in the document.");
            return;
        }

        var window = PaletteFactory.Create($"{commandName} - Place Families",
            new PaletteOptions<FamilyPlacementItem> {
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                Tabs = [new TabDefinition<FamilyPlacementItem> {
                    Name = "All",
                    ItemProvider = () => items,
                    Actions = [
                        new() {
                            Name = "Place",
                            Execute = async item => {
                                Console.WriteLine($"[FamilyPlacement] Starting placement for: {item.Family.Name}");

                                var symbol = item.GetFirstSymbol();
                                if (symbol == null) {
                                    Console.WriteLine($"[FamilyPlacement] No symbol found for: {item.Family.Name}");
                                    new Ballogger()
                                        .Add(LogEventLevel.Warning, new StackFrame(),
                                            $"Family '{item.Family.Name}' has no types to place")
                                        .Show();
                                    return;
                                }

                                Console.WriteLine($"[FamilyPlacement] Symbol found: {symbol.Name}, IsActive: {symbol.IsActive}");

                                var uiDoc = uiApp.ActiveUIDocument;
                                var doc = uiDoc.Document;

                                try {
                                    // Activate symbol if needed (requires transaction)
                                    if (!symbol.IsActive) {
                                        Console.WriteLine("[FamilyPlacement] Activating symbol...");
                                        using var activateTrans = new Transaction(doc, "Activate Family Symbol");
                                        _ = activateTrans.Start();
                                        symbol.Activate();
                                        _ = activateTrans.Commit();
                                        Console.WriteLine("[FamilyPlacement] Symbol activated");
                                    }

                                    Console.WriteLine("[FamilyPlacement] Prompting for point pick...");
                                    // Prompt user to pick a point for placement
                                    var point = uiDoc.Selection.PickPoint($"Click to place {item.Family.Name}");
                                    Console.WriteLine($"[FamilyPlacement] Point picked: {point}");

                                    // Place the family instance at the picked point
                                    using var trans = new Transaction(doc, "Place Family Instance");
                                    _ = trans.Start();
                                    var instance = doc.Create.NewFamilyInstance(point, symbol, StructuralType.NonStructural);
                                    _ = trans.Commit();
                                    Console.WriteLine($"[FamilyPlacement] Instance created: {instance?.Id}");

                                    // Reopen the palette with the same family list for continued placement
                                    Console.WriteLine("[FamilyPlacement] Reopening palette after successful placement");
                                    ShowFamilyPlacementPalette(uiApp, familyNames, commandName);
                                } catch (OperationCanceledException) {
                                    Console.WriteLine("[FamilyPlacement] User canceled placement (Escape pressed)");
                                    // User pressed Escape during point picking
                                    // Reopen palette anyway so they can choose another family or close it
                                    ShowFamilyPlacementPalette(uiApp, familyNames, commandName);
                                } catch (Exception ex) {
                                    Console.WriteLine($"[FamilyPlacement] ERROR: {ex.GetType().Name}: {ex.Message}");
                                    new Ballogger()
                                        .Add(LogEventLevel.Error, new StackFrame(), ex, true)
                                        .Show();
                                    // Still reopen palette on error
                                    ShowFamilyPlacementPalette(uiApp, familyNames, commandName);
                                }

                                await Task.CompletedTask;
                            },
                            CanExecute = item => item != null
                        }
                    ]
                }]
                // Note: KeepOpenAfterAction cannot be used here because transactions
                // require Revit API context (deferred execution), which closes the window
            });

        window.Show();
    }
}

/// <summary>
///     Palette item for placing a family.
/// </summary>
public class FamilyPlacementItem : IPaletteListItem {
    public FamilyPlacementItem(Family family) => this.Family = family;
    public Family Family { get; }

    public string TextPrimary => this.Family.Name;

    public string TextSecondary {
        get {
            var symbolIds = this.Family.GetFamilySymbolIds();
            var typeCount = symbolIds.Count;
            return typeCount == 1 ? "1 type" : $"{typeCount} types";
        }
    }

    public string TextPill => this.Family.FamilyCategory?.Name ?? string.Empty;

    public Func<string> GetTextInfo => () =>
        $"Category: {this.Family.FamilyCategory?.Name ?? "Unknown"}\n" +
        $"Types: {this.Family.GetFamilySymbolIds().Count}\n" +
        $"Id: {this.Family.Id}";

    public BitmapImage Icon => null;
    public Color? ItemColor => null;

    public FamilySymbol GetFirstSymbol() {
        var symbolIds = this.Family.GetFamilySymbolIds();
        if (symbolIds.Count == 0)
            return null;

        return this.Family.Document.GetElement(symbolIds.First()) as FamilySymbol;
    }
}