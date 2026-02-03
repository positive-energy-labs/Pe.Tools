using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.App.Tasks;
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

            // Refresh task registry on every palette open to support hot-reload
            Log.Information("Refreshing task registry...");
            TaskInitializer.RegisterAllTasks();

            // Load all registered tasks and create TaskItems
            var taskItems = TaskRegistry.Instance.GetAll()
                .Select(tuple => new TaskItem {
                    Id = tuple.Id,
                    Task = tuple.Task,
                    UsageCount = 0, // Will be populated by SearchFilterService
                    LastUsed = DateTime.MinValue
                })
                .ToList();

            var window = PaletteFactory.Create("Task Palette",
                new PaletteOptions<TaskItem> {
                    Persistence = (persistence, item => item.Id),
                    SearchConfig = SearchConfig.PrimaryAndSecondary(),
                    Tabs = [
                        new TabDefinition<TaskItem>(
                            "All",
                            () => taskItems,
                            new PaletteAction<TaskItem> {
                                Name = "Execute",
                                Execute = async item => {
                                    try {
                                        Console.WriteLine($"Executing task: {item.Task.Name}");
                                        await item.Task.ExecuteAsync(uiapp);
                                        Console.WriteLine($"Task '{item.Task.Name}' completed\n");
                                    } catch (Exception ex) {
                                        Console.WriteLine($"Task '{item.Task.Name}' failed: {ex.Message}");
                                        Console.WriteLine(ex.StackTrace);
                                    }
                                },                            }
                        ) {
                            FilterKeySelector = item => item.Task.Category ?? string.Empty
                        }
                    ]
                });
            window.Show();

            return Result.Succeeded;
        } catch (Exception ex) {
            throw new InvalidOperationException($"Error opening task palette: {ex.Message}");
        }
    }
}