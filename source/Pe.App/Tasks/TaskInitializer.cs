namespace Pe.App.Tasks;

/// <summary>
///     Forces all task static constructors to run, registering tasks with the registry.
///     Called during application startup.
/// </summary>
internal static class TaskInitializer {
    public static void RegisterAllTasks() {
        // Calling Register() on each task class forces static constructor to run
        DebugParametersTask.Register();
        ExampleTask.Register();
        PrintDocumentInfoTask.Register();
        FlipElement180Task.Register();
        ExportApsParametersTask.Register();

        // Add new tasks here...

        // FUTURE: Use reflection to auto-discover all ITask implementations
        // This removes the need to manually list each task
    }
}
