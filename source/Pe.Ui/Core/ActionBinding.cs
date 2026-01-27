using System.Windows.Input;

namespace Pe.Ui.Core;

/// <summary>
///     Non-generic base class for ActionBinding to enable type-erased storage
/// </summary>
public abstract class ActionBinding {
    /// <summary>
    ///     Gets all registered actions as untyped objects
    /// </summary>
    public abstract IEnumerable<object> GetAllActionsUntyped();
}

/// <summary>
///     Manages action registration and execution for palette items
/// </summary>
public class ActionBinding<TItem> : ActionBinding where TItem : class, IPaletteListItem {
    private readonly List<PaletteAction<TItem>> _actions = new();

    /// <summary>
    ///     Registers an action with the binding system
    /// </summary>
    public void Register(PaletteAction<TItem> action) => this._actions.Add(action);

    /// <summary>
    ///     Registers multiple actions
    /// </summary>
    public void RegisterRange(IEnumerable<PaletteAction<TItem>> actions) => this._actions.AddRange(actions);

    /// <summary>
    ///     Gets all available actions for a given item (filtered by CanExecute)
    /// </summary>
    public IEnumerable<PaletteAction<TItem>> GetAvailableActions(TItem item) =>
        this._actions.Where(a => a.CanExecute(item));

    /// <summary>
    ///     Non-generic helper to check if any action can execute for an item
    ///     Used by UI controls that don't know the generic type
    /// </summary>
    public bool HasAvailableActions(IPaletteListItem item) {
        if (item is not TItem typedItem) return false;
        return this.GetAvailableActions(typedItem).Any();
    }

    /// <summary>
    ///     Gets all registered actions (not filtered by CanExecute)
    /// </summary>
    public IEnumerable<PaletteAction<TItem>> GetAllActions() => this._actions;

    /// <inheritdoc />
    public override IEnumerable<object> GetAllActionsUntyped() => this._actions;

    /// <summary>
    ///     Executes the action's Execute delegate for a given item.
    ///     Throws if no Execute method is defined.
    /// </summary>
    public async Task ExecuteAsync(PaletteAction<TItem> action, TItem item) {
        if (action.Execute == null)
            throw new InvalidOperationException($"Action '{action.Name}' has no Execute method defined");

        await action.Execute(item);
    }

    /// <summary>
    ///     Finds the matching action for a keyboard event without executing it.
    ///     Returns null if no action matches or CanExecute returns false.
    /// </summary>
    public PaletteAction<TItem> TryFindAction(TItem item, Key key, ModifierKeys modifiers) {
        var action = this.FindMatchingAction(key, modifiers);
        if (action == null || !action.CanExecute(item)) return null;
        return action;
    }

    /// <summary>
    ///     Finds the matching action for a mouse event without executing it.
    ///     Returns null if no action matches or CanExecute returns false.
    /// </summary>
    public PaletteAction<TItem> TryFindAction(TItem item, ModifierKeys modifiers) {
        var action = this.FindMatchingAction(null, modifiers);
        if (action == null || !action.CanExecute(item)) return null;
        return action;
    }

    /// <summary>
    ///     Finds the best matching action for the given input combination
    /// </summary>
    private PaletteAction<TItem> FindMatchingAction(Key? key, ModifierKeys modifiers) {
        // Find exact matches first (most specific)
        // Match if modifiers match AND (key matches OR action has no specific key)
        var exactMatch = this._actions.FirstOrDefault(a =>
            a.Modifiers == modifiers &&
            (a.Key == null || (key.HasValue && a.Key == key)));

        if (exactMatch != null) return exactMatch;

        // Fall back to default action (no modifiers, no specific key/button)
        return this._actions.FirstOrDefault(a =>
            a.Modifiers == ModifierKeys.None &&
            a.Key == null);
    }
}