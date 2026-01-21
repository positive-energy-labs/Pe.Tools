namespace Pe.Global.Services.SignalR.Actions;

/// <summary>
///     Registry of available action handlers.
/// </summary>
public class ActionRegistry {
    private readonly Dictionary<string, IActionHandler> _handlers = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    ///     Register an action handler.
    /// </summary>
    public void Register(IActionHandler handler) {
        this._handlers[handler.ActionName] = handler;
    }

    /// <summary>
    ///     Resolve an action handler by name.
    /// </summary>
    public IActionHandler? Resolve(string actionName) {
        return this._handlers.TryGetValue(actionName, out var handler) ? handler : null;
    }

    /// <summary>
    ///     Get all registered action names.
    /// </summary>
    public IEnumerable<string> GetRegisteredActions() => this._handlers.Keys;

    /// <summary>
    ///     Get actions for a specific settings type.
    /// </summary>
    public IEnumerable<IActionHandler> GetActionsForType(string settingsTypeName) {
        return this._handlers.Values.Where(h =>
            h.SettingsTypeName.Equals(settingsTypeName, StringComparison.OrdinalIgnoreCase));
    }
}
