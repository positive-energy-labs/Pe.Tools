using Pe.App.Commands.Palette.TaskPalette;
using Serilog;
using System.Reflection;

namespace Pe.App.Tasks;

/// <summary>
///     Handles task discovery and registration using reflection.
///     Supports hot-reloading by scanning the assembly for ITask implementations.
/// </summary>
public static class TaskInitializer {
    /// <summary>
    ///     Discovers and registers all ITask implementations in the current assembly.
    ///     This method clears existing registrations and re-scans, supporting hot-reload scenarios.
    /// </summary>
    public static void RegisterAllTasks() {
        // Clear existing tasks to support re-registration (hot reload)
        TaskRegistry.Instance.Clear();

        // Find all non-abstract classes that implement ITask
        var taskTypes = Assembly.GetExecutingAssembly()
            .GetTypes()
            .Where(t => typeof(ITask).IsAssignableFrom(t)
                        && t is { IsClass: true, IsAbstract: false });

        foreach (var taskType in taskTypes) {
            try {
                if (Activator.CreateInstance(taskType) is not ITask task) {
                    Log.Warning("Failed to create task instance for {TaskType}", taskType.FullName);
                    continue;
                }

                TaskRegistry.Instance.RegisterByType(taskType, task);
            } catch (Exception ex) {
                Log.Warning(ex, "Failed to register task {TaskType}", taskType.FullName);
            }
        }

        var count = TaskRegistry.Instance.GetAll().Count;
        Log.Information("Registered {TaskCount} tasks", count);
    }
}