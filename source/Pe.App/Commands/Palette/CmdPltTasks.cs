using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Global.Services.Storage;
using Pe.Ui.Core;
using Pe.Ui.Core.Services;
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
        Log.Information("Refreshing task registry...");
        Pe.App.Tasks.TaskInitializer.RegisterAllTasks();

        // Load all registered tasks and create TaskItems
        var taskItems = TaskRegistry.Instance.GetAll()
            .Select(tuple => new TaskItem {
                Id = tuple.Id,
                Task = tuple.Task,
                UsageCount = 0, // Will be populated by SearchFilterService
                LastUsed = DateTime.MinValue
            })
            .ToList();

        // Actions: Execute task
        var actions = new List<PaletteAction<TaskItem>> {
            new() {
                Name = "Execute",
                Execute = async item => {
                    try {
                        Console.WriteLine($"Executing task: {item.Task.Name}");
                        await item.Task.ExecuteAsync(uiApp);
                        Console.WriteLine($"Task '{item.Task.Name}' completed\n");
                    } catch (Exception ex) {
                        Console.WriteLine($"Task '{item.Task.Name}' failed: {ex.Message}");
                        Console.WriteLine(ex.StackTrace);
                    }
                },
                CanExecute = _ => true
            }
        };

        // Use PaletteFactory for consistency
        return PaletteFactory.Create("Task Palette", taskItems, actions,
            new PaletteOptions<TaskItem> {
                Persistence = (persistence, item => item.Id),
                SearchConfig = SearchConfig.PrimaryAndSecondary(),
                Tabs = [new TabDefinition<TaskItem> {
                    Name = "All",
                    Filter = null,
                    FilterKeySelector = item => item.Task.Category ?? string.Empty
                }]
            });
    }
}
