using Autodesk.Revit.UI;

namespace Pe.Global.Services.SignalR.Actions;

/// <summary>
///     Interface for action handlers that execute Revit operations from the settings editor.
/// </summary>
public interface IActionHandler {
    /// <summary>
    ///     The unique action name (e.g., "AutoTag.CatchUp", "FF.ProcessFamilies").
    /// </summary>
    string ActionName { get; }

    /// <summary>
    ///     The settings type name this handler operates on.
    /// </summary>
    string SettingsTypeName { get; }

    /// <summary>
    ///     Execute the action, persisting settings first if needed.
    /// </summary>
    /// <param name="uiApp">The Revit UIApplication</param>
    /// <param name="settings">Deserialized settings object</param>
    /// <returns>Optional result object</returns>
    object? Execute(UIApplication uiApp, object settings);

    /// <summary>
    ///     Execute the action without persisting settings ("run without saving").
    /// </summary>
    /// <param name="uiApp">The Revit UIApplication</param>
    /// <param name="settings">Deserialized settings object</param>
    /// <returns>Optional result object</returns>
    object? ExecuteWithoutPersist(UIApplication uiApp, object settings);

    /// <summary>
    ///     Whether this action supports progress reporting.
    /// </summary>
    bool SupportsProgress => false;

    /// <summary>
    ///     Execute with progress reporting for long-running operations.
    /// </summary>
    void ExecuteWithProgress(UIApplication uiApp, object settings, Action<ProgressUpdate> onProgress) {
        // Default implementation just calls Execute
        _ = this.Execute(uiApp, settings);
        onProgress(new ProgressUpdate(100, "Complete", null));
    }
}

/// <summary>
///     Strongly-typed base class for action handlers.
/// </summary>
public abstract class ActionHandler<TSettings> : IActionHandler where TSettings : class {
    public abstract string ActionName { get; }
    public abstract string SettingsTypeName { get; }

    object? IActionHandler.Execute(UIApplication uiApp, object settings) =>
        this.Execute(uiApp, (TSettings)settings);

    object? IActionHandler.ExecuteWithoutPersist(UIApplication uiApp, object settings) =>
        this.ExecuteWithoutPersist(uiApp, (TSettings)settings);

    public abstract object? Execute(UIApplication uiApp, TSettings settings);
    public abstract object? ExecuteWithoutPersist(UIApplication uiApp, TSettings settings);
}
