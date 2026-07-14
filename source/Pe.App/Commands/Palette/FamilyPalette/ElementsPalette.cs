using Autodesk.Revit.UI;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Global.Ui;
using Pe.Revit.Ui.Core;
using Pe.Revit.Ui.Core.Services;
using Pe.Shared.StorageRuntime;
using Serilog;
using Serilog.Events;
using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Windows.Input;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     The doc-adaptive Elements palette: quickly select/zoom placed things in the
///     current document. In a family document it shows family elements (params, dims,
///     ref planes, connectors); in a project document it shows placed family instances.
///     ponytail: project mode is family instances only — more element kinds when needed.
/// </summary>
internal static class ElementsPalette {
    internal const string Title = "Elements";

    internal static Result Show(UIApplication uiapp) {
        var doc = uiapp.ActiveUIDocument?.Document;
        if (doc == null) return Result.Failed;

        return doc.IsFamilyDocument
            ? FamilyElementsPaletteBase.ShowPalette(uiapp, 0)
            : ShowInstances(uiapp);
    }

    private static Result ShowInstances(UIApplication uiapp) {
        try {
            var uidoc = uiapp.GetActiveUIDocument();
            var doc = uidoc?.Document;
            if (doc == null || uidoc == null) {
                Log.Error("Failed to get active document or UIDocument");
                return Result.Failed;
            }

            var previewPanel = new FamilyPreviewPanel(doc);
            var instancesOptions = new FamilyInstancesOptions();

            var availableCategories = new ObservableCollection<string>();
            foreach (var category in FamilyActions.CollectFamilyCategories(doc, uidoc, instancesOptions))
                availableCategories.Add(category);

            var trayPanel = new FamilyInstancesTrayPanel(instancesOptions, availableCategories);

            var window = PaletteFactory.Create(Title,
                new PaletteOptions<UnifiedFamilyItem> {
                    Persistence = (StorageClient.Default.Module(nameof(CmdPltFamilyInstances)),
                        item => item.PersistenceKey),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = [
                        new TabDefinition<UnifiedFamilyItem>(
                            "Instances",
                            () => FamilyActions.CollectFamilyInstances(doc, uidoc, instancesOptions),
                            new PaletteAction<UnifiedFamilyItem> {
                                Name = "Zoom To",
                                Execute = item => {
                                    FamilyActions.HandleZoomToFamilyInstance(item);
                                }
                            },
                            new PaletteAction<UnifiedFamilyItem> {
                                Name = "Open/Edit",
                                Modifiers = ModifierKeys.Control,
                                Execute = item => {
                                    FamilyActions.HandleOpenEditFamily(item);
                                },
                                CanExecute = item => item?.GetFamily()?.IsEditable == true
                            },
                            new PaletteAction<UnifiedFamilyItem> {
                                Name = "Snoop",
                                Modifiers = ModifierKeys.Alt,
                                Execute = item => {
                                    FamilyActions.HandleSnoop(doc, item);
                                }
                            }
                        ) { FilterKeySelector = i => i.TextPrimary }
                    ],
                    SidebarPanel = previewPanel,
                    Tray = new PaletteTray { Content = trayPanel, MaxHeight = 250 },
                    ViewModelMutator = vm => {
                        // Reload items + categories when tray options change
                        instancesOptions.PropertyChanged += (_, e) => {
                            var shouldRefreshCategories =
                                e.PropertyName is nameof(FamilyInstancesOptions.ShowAnnotationSymbols)
                                    or nameof(FamilyInstancesOptions.FilterByActiveView);
                            if (shouldRefreshCategories) {
                                availableCategories.Clear();
                                foreach (var category in FamilyActions.CollectFamilyCategories(doc, uidoc,
                                             instancesOptions))
                                    availableCategories.Add(category);
                            }

                            vm.InvalidateTabCache(0);
                        };
                    }
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            Log.Error(ex, "Elements palette failed to open");
            new Ballogger().Add(LogEventLevel.Error, new StackFrame(), ex, true).Show();
            return Result.Failed;
        }
    }
}
