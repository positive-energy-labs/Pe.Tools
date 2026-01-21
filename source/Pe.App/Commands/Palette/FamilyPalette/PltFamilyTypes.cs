using Autodesk.Revit.UI;
using Pe.Global.Revit.Ui;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog.Events;
using System.Diagnostics;
using System.Windows;
using System.Windows.Media.Imaging;
using Color = System.Windows.Media.Color;
using OperationCanceledException = Autodesk.Revit.Exceptions.OperationCanceledException;

namespace Pe.App.Commands.Palette;

/// <summary>
///     Secondary palette for displaying and placing family types.
///     Opened from the family palette (CmdPltFamilies) when user selects a family.
/// </summary>
public static class PltFamilyTypes {
    /// <summary>
    ///     Creates a palette window for displaying family types.
    /// </summary>
    public static Window CreatePalette(UIApplication uiapp, Family family) {
        var doc = uiapp.ActiveUIDocument.Document;
        var activeView = uiapp.ActiveUIDocument.ActiveView;

        var items = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .Cast<FamilySymbol>()
            .Where(f => f.Family.Id == family.Id)
            .OrderBy(f => f.Name)
            .Select(f => new FamilyTypePaletteItem(f))
            .ToList();

        var actions = new List<PaletteAction<FamilyTypePaletteItem>> {
            new() {
                Name = "Place",
                Execute = async item => {
                    var symbol = item.FamilySymbol;
                    try {
                        var trans = new Transaction(doc, $"Place {symbol.Family.Name}");
                        trans.Start();
                        if (!symbol.IsActive) symbol.Activate();
                        trans.Commit();
                        uiapp.ActiveUIDocument.PromptForFamilyInstancePlacement(symbol);
                    } catch (OperationCanceledException) {
                        // User canceled placement - this is expected behavior, not an error
                    } catch (Exception ex) {
                        new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
                    }
                },
                CanExecute = item => {
                    if (item == null) return false;

                    // Check if active view is valid for placing families
                    return !activeView.IsTemplate
                           && activeView.ViewType != ViewType.Legend
                           && activeView.ViewType != ViewType.DrawingSheet
                           && activeView.ViewType != ViewType.DraftingView
                           && activeView.ViewType != ViewType.SystemBrowser
                           && activeView is not ViewSchedule;
                }
            }
        };

        var window = PaletteFactory.Create($"{family.Name} Types", items, actions,
            new PaletteOptions<FamilyTypePaletteItem> { SearchConfig = SearchConfig.Default() });

        return window;
    }
}

public class FamilyTypePaletteItem(FamilySymbol familySymbol) : IPaletteListItem {
    public FamilySymbol FamilySymbol { get; } = familySymbol;
    public string TextPrimary => this.FamilySymbol.Name;
    public string TextSecondary => string.Empty;
    public string TextPill => string.Empty;

    public Func<string> GetTextInfo => () =>
        $"{this.FamilySymbol.Name} - {this.FamilySymbol.Family.Name} - {this.FamilySymbol.Family.FamilyCategory?.Name ?? string.Empty}";

    public BitmapImage Icon => null;
    public Color? ItemColor => null;
}