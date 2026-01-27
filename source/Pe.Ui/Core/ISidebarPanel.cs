using System.Threading;
using System.Windows;

namespace Pe.Ui.Core;

/// <summary>
///     Contract for sidebar panels that can be automatically wired to palette selection.
///     Implement this interface to enable auto-wiring in <see cref="PaletteFactory" />.
/// </summary>
/// <typeparam name="TItem">The palette item type</typeparam>
public interface ISidebarPanel<in TItem> where TItem : class, IPaletteListItem {
    /// <summary>
    ///     Called immediately when selection changes, before debounce.
    ///     Use this to clear stale content or show a loading indicator.
    ///     Keep this method lightweight - it runs on every selection change.
    /// </summary>
    void Clear() { }

    /// <summary>
    ///     Called when the selected item changes (debounced).
    ///     Null indicates no selection or selection was cleared.
    ///     For expensive operations, use the cancellation token to abort if selection changes.
    /// </summary>
    /// <param name="item">The newly selected item, or null if cleared</param>
    /// <param name="ct">Cancellation token that fires when selection changes again</param>
    void Update(TItem? item, CancellationToken ct);

    /// <summary>
    ///     The UIElement to display in the sidebar.
    /// </summary>
    UIElement Content { get; }

    /// <summary>
    ///     Optional preferred width for the sidebar. Null uses the default (450px).
    /// </summary>
    GridLength? PreferredWidth => null;
}
