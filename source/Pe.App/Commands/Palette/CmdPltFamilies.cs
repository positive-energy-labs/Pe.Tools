using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Extensions.UiApplication;
using Pe.Global.Services.Storage;
using Pe.Global.Revit.Ui;
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
            var activeView = uiapp.ActiveUIDocument.ActiveView;

            var items = new FilteredElementCollector(doc)
                .OfClass(typeof(Family))
                .Cast<Family>()
                .Where(f => !string.IsNullOrWhiteSpace(f.Name))
                .OrderBy(f => f.Name)
                .Select(f => new FamilyPaletteItem(f, doc));

            var actions = new List<PaletteAction<FamilyPaletteItem>> {
                // Default action: Open family types palette as new window (Enter or Click)
                new() {
                    Name = "Types",
                    Execute = async item => PltFamilyTypes.CreatePalette(uiapp, item.Family).Show(),
                    CanExecute = item => item != null
                },
                new() {
                    Name = "Select in View",
                    Modifiers = ModifierKeys.Shift,
                    Execute = async item => {
                        var instances = new FilteredElementCollector(doc)
                            .OfClass(typeof(FamilyInstance))
                            .Cast<FamilyInstance>()
                            .Where(fi => fi.Symbol.Family.Id == item.Family.Id)
                            .Select(fi => fi.Id)
                            .ToList();
                        uiapp.ActiveUIDocument.Selection.SetElementIds(instances);
                    },
                    CanExecute = item => item != null && !activeView.IsTemplate
                                                      && activeView.ViewType != ViewType.Legend
                                                      && activeView.ViewType != ViewType.DrawingSheet
                                                      && activeView.ViewType != ViewType.DraftingView
                                                      && activeView.ViewType != ViewType.SystemBrowser
                                                      && activeView is not ViewSchedule && item.Family.IsEditable
                },
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
        } catch (Exception ex) {
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}

/// <summary>
///     Adapter that wraps Revit Family to implement ISelectableItem
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