namespace Pe.Revit.Ui.Core;

/// <summary>
///     Static accessor for the SDK Revit task queue, allowing shared projects
///     to defer actions to Revit API context without referencing the main project.
/// </summary>
/// <remarks>
///     This must be wired up in App.cs during startup:
///     <code>RevitTaskAccessor.RunAsync = action => queue.Run(_ => action());</code>
/// </remarks>
public static class RevitTaskAccessor {
    /// <summary>
    ///     Delegate to execute a synchronous action in Revit API context.
    ///     Returns a Task that completes when the action has executed.
    /// </summary>
    public static Func<Action, Task>? RunAsync { get; set; }

    /// <summary>
    ///     Whether the accessor has been configured with a valid delegate.
    /// </summary>
    public static bool IsConfigured => RunAsync != null;
}
