using Pe.Ui.Core;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace Pe.App.Commands.Palette.TaskPalette;

/// <summary>
///     Wraps an ITask for display in the Task Palette.
///     Tracks usage statistics for smart ordering.
/// </summary>
public class TaskItem : IPaletteListItem {
    /// <summary>
    ///     The underlying task implementation
    /// </summary>
    public required ITask Task { get; init; }

    /// <summary>
    ///     Unique identifier derived from the task's type name.
    ///     Used for persistence and duplicate prevention.
    /// </summary>
    public required string Id { get; init; }

    /// <summary>
    ///     Number of times this task has been used (for prioritization)
    /// </summary>
    public int UsageCount { get; set; }

    /// <summary>
    ///     Last time this task was executed
    /// </summary>
    public DateTime LastUsed { get; set; }

    // IPaletteListItem implementation
    public string TextPrimary => this.Task.Name;
    public string TextSecondary => this.Task.Description ?? string.Empty;
    public string TextPill => this.Task.Category ?? string.Empty;
    public Func<string> GetTextInfo => () => this.Task.Description ?? string.Empty;
    public BitmapImage Icon => null; // Future: custom icons per task
    public System.Windows.Media.Color? ItemColor => null; // Future: category-based colors
}
