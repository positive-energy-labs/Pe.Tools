using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.Revit.Global.Revit.Ui;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.StorageRuntime;
using Serilog;
using Serilog.Events;
using System.Collections.ObjectModel;
using System.Diagnostics;

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

            return ShowPalette(this.DefaultTabIndex);
        } catch (Exception ex) {
            Log.Error(ex, "Family palette command failed");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }

    internal static Result ShowPalette(int defaultTabIndex, string? filterValue = null) {
        try {
            var uiapp = DocumentManager.uiapp;
            var doc = DocumentManager.GetActiveDocument();
            var uidoc = DocumentManager.GetActiveUIDocument();
            if (doc == null || uidoc == null) {
                Log.Error("Failed to get active document or UIDocument");
                return Result.Failed;
            }

            // Create preview panel for sidebar
            var previewPanel = new FamilyPreviewPanel(doc);

            // Create tab definitions with lazy loading
            var (tabs, instancesOptions) = FamilyTabConfig.CreateTabs(doc, uidoc);

            // Create tray panel for Family palette tabs
            PaletteTray? tray = null;
            var availableCategories = new ObservableCollection<string>();
            if (instancesOptions != null) {
                // Collect available categories for the filter
                foreach (var category in FamilyActions.CollectFamilyCategories(doc, uidoc, instancesOptions))
                    availableCategories.Add(category);

                var trayPanel = new FamilyInstancesTrayPanel(instancesOptions, availableCategories);
                tray = new PaletteTray { Content = trayPanel, MaxHeight = 250 };
            }

            var window = PaletteFactory.Create("Family Palette",
                new PaletteOptions<UnifiedFamilyItem> {
                    Persistence = (StorageClient.Default.Module(nameof(CmdPltFamilies)), item => item.PersistenceKey),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = tabs,
                    DefaultTabIndex = defaultTabIndex,
                    SidebarPanel = previewPanel,
                    Tray = tray,
                    ViewModelMutator = vm => {
                        // Apply initial filter if provided
                        if (!string.IsNullOrWhiteSpace(filterValue)) {
                            vm.SelectedFilterValue = filterValue;
                            if (vm.FilteredItems.Count > 0)
                                vm.SelectedIndex = 0;
                        }

                        // Wire up property change notifications to reload items when options change
                        if (instancesOptions != null) {
                            instancesOptions.PropertyChanged += (sender, e) => {
                                var shouldRefreshCategories =
                                    e.PropertyName is nameof(FamilyInstancesOptions.ShowAnnotationSymbols)
                                        or nameof(FamilyInstancesOptions.FilterByActiveView);
                                if (shouldRefreshCategories) {
                                    availableCategories.Clear();
                                    foreach (var category in FamilyActions.CollectFamilyCategories(doc, uidoc,
                                                 instancesOptions))
                                        availableCategories.Add(category);
                                }

                                // Invalidate all Family palette tabs when any option changes
                                vm.InvalidateTabCache(0);
                                vm.InvalidateTabCache(1);
                                vm.InvalidateTabCache(2);
                            };
                        }
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
}
