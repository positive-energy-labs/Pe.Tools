using Autodesk.Revit.UI;

namespace Pe.App.Commands.Palette.TaskPalette;

/// <summary>
///     Represents an executable task that can be run from the Task Palette.
///     Designed for prototyping, testing, and one-off operations.
/// </summary>
public interface ITask {
    /// <summary>
    ///     Display name shown in the palette
    /// </summary>
    string Name { get; }

    /// <summary>
    ///     Optional description for tooltip/preview panel
    /// </summary>
    string? Description { get; }

    /// <summary>
    ///     Optional category for grouping and filtering tasks
    ///     Examples: "Debug", "Testing", "Cleanup", "Export"
    /// </summary>
    string? Category { get; }

    /// <summary>
    ///     Executes the task. Called within Revit API context.
    /// </summary>
    /// <param name="uiApp">UIApplication for accessing Revit API</param>
    // FOOTGUN: tasks run synchronously in Revit API context — asynchronous continuations do not
    // retain it. Implementations must stay synchronous; move background work outside the task and
    // marshal only the synchronous Revit segment back in.
    void Execute(UIApplication uiApp);
}
