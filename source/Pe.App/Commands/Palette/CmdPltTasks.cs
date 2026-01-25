using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
using Pe.Ui.ViewModels;
using Serilog;

namespace Pe.App.Commands.Palette;

[Transaction(TransactionMode.Manual)]
public class CmdPltTasks : IExternalCommand {
    public Result Execute(
        ExternalCommandData commandData,
        ref string message,
        ElementSet elementSet
    ) {
        try {
            var uiapp = commandData.Application;
            var persistence = new Storage(nameof(CmdPltTasks));

            var palette = TaskPaletteService.Create(uiapp, persistence);
            palette.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            throw new InvalidOperationException($"Error opening task palette: {ex.Message}");
        }
    }
}

public static class TaskPaletteService {
    public static EphemeralWindow Create(UIApplication uiApp, Storage persistence) {
        // Refresh task registry on every palette open to support hot-reload
        Log.Information("🔄 Refreshing task registry...");
        Pe.App.Tasks.TaskInitializer.RegisterAllTasks();

        // Load all registered tasks
        var registeredTasks = TaskRegistry.Instance.GetAll();

        // Create TaskItems
        var taskItems = registeredTasks.Select(tuple => {
            var (id, task) = tuple;
            return new TaskItem {
                Id = id,
                Task = task,
                UsageCount = 0, // Will be populated by SearchFilterService
                LastUsed = DateTime.MinValue
            };
        }).ToList();

        // Get all unique categories for filtering
        var categories = TaskRegistry.Instance.GetAllCategories();

        // Create search service (search by name and description)
        var searchConfig = SearchConfig.PrimaryAndSecondary();
        var searchService = new SearchFilterService<TaskItem>(
            persistence,
            item => item.Id,
            searchConfig);

        // Load usage data from persistence
        searchService.LoadUsageData();

        // Build search cache for efficient filtering
        searchService.BuildSearchCache(taskItems);

        // Actions: Execute and Refresh
        var actions = new List<PaletteAction<TaskItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    try {
                        Console.WriteLine($"▶ Executing task: {item.Task.Name}");
                        await item.Task.ExecuteAsync(uiApp);

                        // Record usage through SearchFilterService
                        searchService.RecordUsage(item);

                        Console.WriteLine($"✓ Task '{item.Task.Name}' completed\n");
                    } catch (Exception ex) {
                        Console.WriteLine($"✗ Task '{item.Task.Name}' failed: {ex.Message}");
                        Console.WriteLine(ex.StackTrace);
                    }
                },
                CanExecute = _ => true
            }
        };

        // Create view model with category filtering
        var viewModel = new PaletteViewModel<TaskItem>(
            taskItems,
            searchService,
            filterKeySelector: item => item.Task.Category ?? string.Empty);

        // Create palette
        var palette = new Ui.Components.Palette();
        palette.Initialize(viewModel, actions);

        // Wrap in window
        var window = new EphemeralWindow(palette, "Task Palette");
        palette.SetParentWindow(window);
        return window;
    }
}
