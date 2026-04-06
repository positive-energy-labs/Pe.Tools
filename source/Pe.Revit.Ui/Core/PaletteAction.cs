using System.Windows.Input;

namespace Pe.Ui.Core;

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
    ///     Action body. Use async lambdas: <c>Execute = async item => await DoWork(item)</c>.
    ///     For sync work: <c>Execute = async item => DoSyncWork(item)</c>.
    /// </summary>
    public Func<TItem, Task> Execute { get; init; } = _ => Task.CompletedTask;

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