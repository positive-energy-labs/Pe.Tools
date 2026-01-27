using System.Windows.Input;

namespace Pe.Ui.Core;

/// <summary>
///     Represents a single action that can be triggered in the palette.
///     Actions are deferred to Revit API context after the window closes.
/// </summary>
public record PaletteAction<TItem> where TItem : IPaletteListItem {
    /// <summary>Display name for the action (for debugging/logging)</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Keyboard modifiers required (Ctrl, Shift, Alt, etc.)</summary>
    public ModifierKeys Modifiers { get; init; } = ModifierKeys.None;

    /// <summary>Keyboard key that triggers this action</summary>
    public Key? Key { get; init; }

    /// <summary>
    ///     Standard action - deferred to Revit API context after window closes.
    ///     Use async lambdas: <c>Execute = async item => await DoWork(item)</c>
    ///     For sync work: <c>Execute = async item => DoSyncWork(item)</c>
    /// </summary>
    public Func<TItem, Task> Execute { get; init; }

    /// <summary>Optional predicate to check if action can execute</summary>
    public Func<TItem, bool> CanExecute { get; init; } = item => item != null;
}