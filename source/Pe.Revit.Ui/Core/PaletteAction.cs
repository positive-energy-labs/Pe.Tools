using System.Windows.Input;

namespace Pe.Revit.Ui.Core;

public enum PaletteActionExecutionLane {
    Revit,
    Ui
}

/// <summary>
///     Represents a single action that can be triggered in the palette.
///     Actions default to Revit execution. Window pinning only affects whether the
///     palette closes before execution, not which lane the action runs on.
/// </summary>
public record PaletteAction<TItem> where TItem : IPaletteListItem {
    /// <summary>Display name for the action (for debugging/logging)</summary>
    public string Name { get; init; } = string.Empty;

    /// <summary>Keyboard modifiers (Ctrl, Shift, Alt, etc.)</summary>
    public ModifierKeys Modifiers { get; init; } = ModifierKeys.None;

    /// <summary>Keyboard key that triggers this action</summary>
    public Key? Key { get; init; }

    /// <summary>
    ///     Synchronous action body. Revit-lane actions run only for the duration of the
    ///     SDK queue callback; asynchronous continuations cannot retain Revit API context.
    /// </summary>
    public Action<TItem> Execute { get; init; } = _ => { };

    /// <summary>
    ///     Controls where the action runs.
    ///     Default: Revit, since most palette actions touch the Revit API.
    /// </summary>
    public PaletteActionExecutionLane ExecutionLane { get; init; } = PaletteActionExecutionLane.Revit;

    /// <summary>
    ///     Optional enablement predicate evaluated on the palette UI side.
    ///     Keep this cheap, side-effect free, and based on already-available state.
    /// </summary>
    public Func<TItem, bool> CanExecute { get; init; } = item => item != null;
}
