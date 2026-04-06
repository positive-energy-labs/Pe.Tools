using System.Windows.Media.Imaging;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Ui.Core;

/// <summary>
///     Interface that all palette items must implement for display and interaction
/// </summary>
public interface IPaletteListItem {
    /// <summary> Main display text (e.g., command name, view name) </summary>
    string TextPrimary { get; }

    /// <summary> Subtitle/description text (e.g., menu paths, view type) </summary>
    string TextSecondary { get; }

    /// <summary> Badge/pill text (e.g., keyboard shortcuts) </summary>
    string? TextPill { get; }

    /// <summary>
    ///     Tooltip text generator for detailed information.
    ///     Returns a function that generates the tooltip text when called.
    ///     This allows expensive tooltip generation to be deferred until the tooltip is actually shown.
    /// </summary>
    Func<string> GetTextInfo { get; }

    /// <summary> Item icon (optional, can be null) </summary>
    BitmapImage? Icon { get; }

    /// <summary> Optional color indicator for the item (e.g., document color) </summary>
    WpfColor? ItemColor { get; }
}