using Pe.App.Commands.Palette;
using Pe.App.Commands.Palette.TaskPalette;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core;

namespace Pe.App.Tasks;

/// <summary>
///     Extension methods for task output management.
/// </summary>
public static class TaskOutputExtensions {
    /// <summary>
    ///     Gets an OutputManager for the specified task type.
    ///     Creates a subdirectory in the output folder named after the task class.
    /// </summary>
    /// <typeparam name="TTask">The task type (used to generate subdirectory name)</typeparam>
    /// <param name="_">The task instance (used for type inference)</param>
    /// <returns>OutputManager scoped to the task's output subdirectory</returns>
    public static OutputManager GetOutput<TTask>(this TTask _) where TTask : ITask {
        var taskTypeName = typeof(TTask).Name;
        var storage = new Storage(nameof(CmdPltTasks));
        return storage.OutputDir().SubDir(taskTypeName);
    }
}
