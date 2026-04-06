using System.Windows.Input;

namespace Pe.Ui.Core;

/// <summary>
///     Interface for popovers that can exit and return focus to their parent
/// </summary>
public interface IPopoverExit {
    /// <summary>
    ///     Keys that will trigger the popover to close when pressed
    /// </summary>
    IEnumerable<Key> CloseKeys { get; set; }

    /// <summary>
    ///     Event raised when the popover requests to exit
    /// </summary>
    event EventHandler ExitRequested;

    /// <summary>
    ///     Requests the popover to exit and return focus
    /// </summary>
    void RequestExit();

    /// <summary>
    ///     Checks if the given key should close the popover
    /// </summary>
    bool ShouldCloseOnKey(Key key);
}