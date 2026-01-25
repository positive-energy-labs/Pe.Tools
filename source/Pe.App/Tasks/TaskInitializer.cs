using System.Reflection;
using Pe.App.Commands.Palette.TaskPalette;

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
                // Create instance and register
                var task = (ITask)Activator.CreateInstance(taskType);
                TaskRegistry.Instance.RegisterByType(taskType, task);
            } catch (Exception ex) {
                Console.WriteLine($"⚠ Failed to register task '{taskType.Name}': {ex.Message}");
            }
        }

        var count = TaskRegistry.Instance.GetAll().Count;
        Console.WriteLine($"✓ Registered {count} tasks");
    }
}
