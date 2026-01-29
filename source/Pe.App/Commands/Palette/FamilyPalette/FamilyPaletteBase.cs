using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette;
using Pe.App.Services;
using Pe.Extensions.UiApplication;
using Pe.Global.PolyFill;
using Pe.Global.Revit.Ui;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Serilog;
using Serilog.Events;
using System.Diagnostics;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     Base class for all family palette commands.
///     Contains shared logic for building and showing the palette.
///     Derived classes only need to specify the default tab index.
/// </summary>
[Transaction(TransactionMode.Manual)]
public abstract class FamilyPaletteBase : IExternalCommand {
    /// <summary>
    ///     Override to specify which tab should be selected by default.
    /// </summary>
    protected abstract int DefaultTabIndex { get; }

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elementSet) {
        try {
            var uiapp = commandData.Application;
            var doc = uiapp.ActiveUIDocument.Document;

            return ShowPalette(uiapp, this.DefaultTabIndex);
        } catch (Exception ex) {
            Log.Error(ex, "Family palette command failed");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    internal static Result ShowPalette(UIApplication uiapp, int defaultTabIndex, string? filterValue = null) {
        try {
            var doc = uiapp.ActiveUIDocument.Document;
            var uidoc = uiapp.ActiveUIDocument;
            var activeView = uidoc.ActiveView;

            // Collect all family items
            var items = CollectAllFamilyItems(doc);

            // Create preview panel for sidebar
            var previewPanel = new FamilyPreviewPanel(doc);

            // Helper to check if view supports family placement
            bool CanPlaceInView() =>
                !activeView.IsTemplate
                && activeView.ViewType != ViewType.Legend
                && activeView.ViewType != ViewType.DrawingSheet
                && activeView.ViewType != ViewType.DraftingView
                && activeView.ViewType != ViewType.SystemBrowser
                && activeView is not ViewSchedule;

            var actions = new List<PaletteAction<UnifiedFamilyItem>> {
                new() {
                    Name = "Family Types",
                    Execute = async item => ShowPalette(uiapp, defaultTabIndex: 1, filterValue: item?.Family?.Name),
                    CanExecute = item => item?.ItemType == FamilyItemType.Family
                },
                new() {
                    Name = "Place",
                    Execute = async item => {
                        if (item?.FamilySymbol == null) return;
                        try {
                            var trans = new Transaction(doc, $"Place {item.FamilySymbol.Family.Name}");
                            _ = trans.Start();
                            if (!item.FamilySymbol.IsActive) item.FamilySymbol.Activate();
                            _ = trans.Commit();
                            uidoc.PromptForFamilyInstancePlacement(item.FamilySymbol);
                        } catch (Autodesk.Revit.Exceptions.OperationCanceledException) {
                            // User canceled placement - expected behavior
                        }
                    },
                    CanExecute = item => item?.ItemType == FamilyItemType.FamilyType && CanPlaceInView()
                },
                new() {
                    Name = "Open/Edit",
                    Modifiers = ModifierKeys.Control,
                    Execute = async item => {
                        if (item == null) return;
                        if (item.ItemType == FamilyItemType.Family && item.Family != null) {
                            uiapp.OpenAndActivateFamily(item.Family);
                            return;
                        }

                        if (item.ItemType == FamilyItemType.FamilyType && item.FamilySymbol != null) {
                            OpenAndActivateFamilyType(uiapp, item.FamilySymbol);
                        }
                    },
                    CanExecute = item => item != null
                                         && item.ItemType != FamilyItemType.FamilyInstance
                                         && item.GetFamily()?.IsEditable == true
                },
                new() {
                    Name = "Inspect Instances",
                    Execute = async item => ShowPalette(uiapp, defaultTabIndex: 2, filterValue: item?.FamilySymbol?.Name),
                    CanExecute = item => item?.ItemType == FamilyItemType.FamilyType
                },
                new() {
                    Name = "Snoop",
                    Modifiers = ModifierKeys.Alt,
                    Execute = async item => {
                        if (item == null) return;
                        object objectToSnoop = item.ItemType switch {
                            FamilyItemType.Family => item.Family!,
                            FamilyItemType.FamilyType => item.FamilySymbol!,
                            FamilyItemType.FamilyInstance => item.FamilyInstance!,
                            _ => throw new InvalidOperationException()
                        };
                        var title = item.ItemType switch {
                            FamilyItemType.Family => $"Family: {item.Family!.Name}",
                            FamilyItemType.FamilyType => $"Type: {item.FamilySymbol!.Family.Name}: {item.FamilySymbol.Name}",
                            FamilyItemType.FamilyInstance => $"Instance: {item.FamilyInstance!.Symbol.Name} ({item.FamilyInstance.Id})",
                            _ => string.Empty
                        };
                        _ = RevitDbExplorerService.TrySnoopObject(uiapp, doc, objectToSnoop, title);
                    },
                    CanExecute = item => item != null
                }
            };

            var window = PaletteFactory.Create("Family Palette", items, actions,
                new PaletteOptions<UnifiedFamilyItem> {
                    Persistence = (new Storage(nameof(CmdPltFamilies)), item => item.PersistenceKey),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = [
                        new TabDefinition<UnifiedFamilyItem> {
                            Name = "Families",
                            Filter = i => i.ItemType == FamilyItemType.Family,
                            FilterKeySelector = i => i.TextPill
                        },
                        new TabDefinition<UnifiedFamilyItem> {
                            Name = "Family Types",
                            Filter = i => i.ItemType == FamilyItemType.FamilyType,
                            FilterKeySelector = i => i.TextPill
                        },
                        new TabDefinition<UnifiedFamilyItem> {
                            Name = "Family Instances",
                            Filter = i => i.ItemType == FamilyItemType.FamilyInstance,
                            FilterKeySelector = i => i.TextPill
                        }
                    ],
                    DefaultTabIndex = defaultTabIndex,
                    SidebarPanel = previewPanel,
                    ViewModelMutator = vm => {
                        if (string.IsNullOrWhiteSpace(filterValue)) return;
                        vm.SelectedFilterValue = filterValue;
                        if (vm.FilteredItems.Count > 0)
                            vm.SelectedIndex = 0;
                    }
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Family palette failed to open");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    private static IEnumerable<UnifiedFamilyItem> CollectAllFamilyItems(Document doc) {
        // Families
        foreach (var family in new FilteredElementCollector(doc)
                     .OfClass(typeof(Family))
                     .Cast<Family>()
                     .Where(f => !string.IsNullOrWhiteSpace(f.Name))
                     .OrderBy(f => f.Name))
            yield return new UnifiedFamilyItem(family, doc);

        // Family Types (Symbols)
        foreach (var symbol in new FilteredElementCollector(doc)
                     .OfClass(typeof(FamilySymbol))
                     .Cast<FamilySymbol>()
                     .OrderBy(s => s.Family.Name)
                     .ThenBy(s => s.Name))
            yield return new UnifiedFamilyItem(symbol, doc);

        // Family Instances
        foreach (var instance in new FilteredElementCollector(doc)
                     .OfClass(typeof(FamilyInstance))
                     .Cast<FamilyInstance>()
                     .OrderBy(i => i.Symbol.Name)
                     .ThenBy(i => i.Id.Value()))
            yield return new UnifiedFamilyItem(instance, doc);
    }

    private static void OpenAndActivateFamilyType(UIApplication uiapp, FamilySymbol symbol) {
        uiapp.OpenAndActivateFamily(symbol.Family);

        var famDoc = DocumentManager.FindOpenFamilyDocument(symbol.Family);
        if (famDoc?.IsFamilyDocument != true) return;

        var familyManager = famDoc.FamilyManager;
        var targetType = familyManager.Types.Cast<FamilyType>().FirstOrDefault(t => t.Name == symbol.Name);
        if (targetType == null) return;

        using var tx = new Transaction(famDoc, $"Set {symbol.Name} Type");
        _ = tx.Start();
        familyManager.CurrentType = targetType;
        _ = tx.Commit();
    }
}
