using System.Windows.Input;

namespace Pe.Ui.Core;

/// <summary>
///     Navigation actions that can be triggered by keyboard in palettes
/// </summary>
public enum NavigationAction {
    /// <summary> Move selection up in the list </summary>
    MoveUp,

    /// <summary> Move selection down in the list </summary>
    MoveDown,

    /// <summary> Execute the currently selected item </summary>
    Execute,

    /// <summary> Cancel and close the palette </summary>
    Cancel
}

/// <summary>
///     Represents a keyboard key combination with optional modifiers for palette navigation
/// </summary>
public class PaletteKeyBinding {
    public PaletteKeyBinding(Key key, ModifierKeys modifiers = ModifierKeys.None) {
        this.Key = key;
        this.Modifiers = modifiers;
    }

    public Key Key { get; set; }
    public ModifierKeys Modifiers { get; set; } = ModifierKeys.None;

    public bool Matches(Key key, ModifierKeys modifiers) =>
        this.Key == key && this.Modifiers == modifiers;

    public override bool Equals(object obj) =>
        obj is PaletteKeyBinding other && this.Key == other.Key && this.Modifiers == other.Modifiers;

    public override int GetHashCode() {
        unchecked {
            var hash = 17;
            hash = (hash * 31) + this.Key.GetHashCode();
            hash = (hash * 31) + this.Modifiers.GetHashCode();
            return hash;
        }
    }

    public override string ToString() {
        var modifierStr = this.Modifiers != ModifierKeys.None ? $"{this.Modifiers}+" : "";
        return $"{modifierStr}{this.Key}";
    }
}

/// <summary>
///     Configuration for custom keyboard navigation in palettes
/// </summary>
public class CustomKeyBindings {
    private readonly Dictionary<PaletteKeyBinding, NavigationAction> _bindings = new();

    /// <summary>
    ///     Adds a key binding for a navigation action
    /// </summary>
    public void Add(Key key, NavigationAction action, ModifierKeys modifiers = ModifierKeys.None) =>
        this._bindings[new PaletteKeyBinding(key, modifiers)] = action;

    /// <summary>
    ///     Tries to get the navigation action for a given key press
    /// </summary>
    public bool TryGetAction(Key key, ModifierKeys modifiers, out NavigationAction action) {
        foreach (var kvp in this._bindings) {
            if (kvp.Key.Matches(key, modifiers)) {
                action = kvp.Value;
                return true;
            }
        }

        action = default;
        return false;
    }

    /// <summary>
    ///     Gets all registered key bindings
    /// </summary>
    public IReadOnlyDictionary<PaletteKeyBinding, NavigationAction> GetAll() => this._bindings;

    /// <summary>
    ///     Creates an empty custom key bindings configuration
    /// </summary>
    public static CustomKeyBindings Empty() => new();
}