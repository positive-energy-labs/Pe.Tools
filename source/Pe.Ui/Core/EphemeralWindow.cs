using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using Wpf.Ui.Markup;
using Color = System.Windows.Media.Color;
using Grid = System.Windows.Controls.Grid;
using TextBlock = Wpf.Ui.Controls.TextBlock;

namespace Pe.Ui.Core;

/// <summary>
///     Wrapper window that handles all ephemeral window lifecycle management:
///     Alt+Tab hiding, window deactivation detection, focus restoration, and closing logic.
/// </summary>
public class EphemeralWindow : Window {
    private const double ZoomStep = 0.025;
    private const double ZoomMin = 0.5;
    private const double ZoomMax = 1.5;

    private readonly Border _contentBorder;
    private readonly ScaleTransform? _zoomTransform;
    private bool _isClosing;

    public EphemeralWindow(Border contentBorder) {
        this._contentBorder = contentBorder;
        this.ContentControl = null;
    }

    public EphemeralWindow(
        UserControl content,
        string title = "Palette",
        bool ephemeralEnabled = true
    ) {
        this.ContentControl = content;
        this.IsEphemeral = ephemeralEnabled;
        this.Title = title;
        this.SizeToContent = SizeToContent.WidthAndHeight; // Size to both dimensions for independent palette/panel sizing
        this.WindowStartupLocation = WindowStartupLocation.CenterScreen;
        this.WindowStyle = WindowStyle.None;
        this.AllowsTransparency = true;
        this.Background = Brushes.Transparent;
        this.ShowInTaskbar = false;
        this.Topmost = true;

        // Load WPF.UI theme resources for this window
        Theme.LoadResources(this);

        // Apply zoom transform for global UI scaling
        this._zoomTransform = new ScaleTransform(ZoomLevel, ZoomLevel);

        // Content border - transparent container, Palette manages its own backgrounds
        // The title is passed to the Palette to render in its title bar area
        this._contentBorder = new Border {
            Child = content,
            Background = Brushes.Transparent,
            LayoutTransform = this._zoomTransform,
            // Allow dragging from anywhere on the palette background
            // (Palette will have its own title bar area for this)
        };

        // Enable dragging from the content area
        this._contentBorder.MouseLeftButtonDown += (_, e) => {
            if (e.ClickCount == 1) this.DragMove();
        };

        // Enable Ctrl+/- zoom adjustment
        this.PreviewKeyDown += this.OnPreviewKeyDown;

        this.Content = this._contentBorder;

        // Set title on Palette if it supports it
        if (content is ITitleable titleable) titleable.SetTitle(title);

        // Subscribe to CloseRequested event if content implements it
        if (content is ICloseRequestable closeable) closeable.CloseRequested += this.OnContentCloseRequested;
    }

    /// <summary>
    ///     Global UI zoom level. 1.0 = 100%, 0.85 = 85%, 1.25 = 125%, etc.
    ///     Applied via LayoutTransform to scale all UI elements proportionally.
    ///     Adjustable at runtime with Ctrl+Plus/Minus.
    /// </summary>
    public static double ZoomLevel { get; set; } = 0.85;

    /// <summary>
    ///     Gets the UserControl content hosted by this window (typically a Palette).
    /// </summary>
    public UserControl? ContentControl { get; }

    /// <summary>
    ///     Base width for the window (default 450). Used when collapsing sidebars.
    /// </summary>
    public double BaseWidth { get; init; } = 450;

    /// <summary>
    ///     Controls whether the window should automatically close when focus is lost.
    ///     Default: true (ephemeral behavior enabled).
    /// </summary>
    public bool IsEphemeral { get; set; } = true;

    private void OnContentCloseRequested(object? sender, CloseRequestedEventArgs e) =>
        this.CloseWindow(e.RestoreFocus);

    /// <summary>
    ///     Handles Ctrl+Plus/Minus for zoom adjustment.
    /// </summary>
    private void OnPreviewKeyDown(object sender, KeyEventArgs e) {
        if (this._zoomTransform == null) return;
        if ((Keyboard.Modifiers & ModifierKeys.Control) == 0) return;

        var zoomDelta = e.Key switch {
            Key.OemPlus => ZoomStep, // +/= key
            Key.Add => ZoomStep, // Numpad +
            Key.OemMinus => -ZoomStep, // -/_ key
            Key.Subtract => -ZoomStep, // Numpad -
            Key.D0 when (Keyboard.Modifiers & ModifierKeys.Control) != 0 => 0, // Reset marker
            _ => (double?)null
        };

        if (zoomDelta == null) return;

        // Ctrl+0 resets to 100%, otherwise adjust by delta
        ZoomLevel = e.Key == Key.D0
            ? 1.0
            : Math.Clamp(ZoomLevel + zoomDelta.Value, ZoomMin, ZoomMax);

        this._zoomTransform.ScaleX = ZoomLevel;
        this._zoomTransform.ScaleY = ZoomLevel;
        e.Handled = true;
    }

    public void CloseWindow(bool restoreFocus = true) {
        if (this._isClosing) return;
        this._isClosing = true;

        if (this.ContentControl is ICloseRequestable closeable)
            closeable.CloseRequested -= this.OnContentCloseRequested;

        if (restoreFocus) RestoreRevitFocus();
        this.Close();
    }

    /// <summary>
    ///     Attempts to restore keyboard shortcut functionality to Revit after palette closes.
    /// </summary>
    /// <remarks>
    ///     <b>KNOWN LIMITATION:</b> This method is unreliable. Users must click the view canvas.
    ///     <b>Key findings from extensive testing:</b>
    ///     <list type="bullet">
    ///         <item>Windows focus (SetForegroundWindow/SetFocus) ≠ Revit's internal keyboard routing</item>
    ///         <item>Keyboard shortcuts only work when the MFC view canvas (AfxFrameOrView140u) has Revit's internal focus</item>
    ///         <item>UI Automation can report HasKeyboardFocus=True while shortcuts still don't work</item>
    ///         <item>After SetForegroundWindow, focus often lands on Chrome_WidgetWin_0 (Revit's embedded browser)</item>
    ///         <item>The issue is worse for views that were already open vs. freshly opened views</item>
    ///     </list>
    ///     Current approach: SetForegroundWindow + simulate mouse click in view area. Again, does not work.
    /// </remarks>
    public static void RestoreRevitFocus() {
        try {
            var revitProcess = Process.GetCurrentProcess();
            var revitHandle = revitProcess.MainWindowHandle;
            if (revitHandle != IntPtr.Zero) {
                var success = SetForegroundWindow(revitHandle);
            }
        } catch {
        }
    }

    protected override void OnClosing(CancelEventArgs e) {
        this._isClosing = true;
        base.OnClosing(e);
    }

    #region Hiding from Alt+Tab and Window Messages

    protected override void OnSourceInitialized(EventArgs e) {
        base.OnSourceInitialized(e);

        // Remove window from Alt+Tab
        var helper = new WindowInteropHelper(this);
        _ = SetWindowLong(
            helper.Handle,
            GWL_EXSTYLE,
            GetWindowLong(helper.Handle, GWL_EXSTYLE) | WS_EX_TOOLWINDOW
        );

        // Hook into window messages to detect activation changes
        var source = HwndSource.FromHwnd(helper.Handle);
        source?.AddHook(this.WndProc);
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) {
        const int WM_ACTIVATE = 0x0006;
        const int WA_INACTIVE = 0;

        if (msg == WM_ACTIVATE) {
            var activateType = (int)wParam & 0xFFFF;

            if (activateType == WA_INACTIVE && !this._isClosing && this.IsEphemeral) {
                // lParam contains the handle of the window being activated (may be zero)
                var newActiveWindow = lParam;
                var revitHandle = Process.GetCurrentProcess().MainWindowHandle;

                // Get actual foreground window (more reliable than lParam)
                var actualForegroundWindow = GetForegroundWindow();

                // Check if Alt key is pressed (Alt+Tab is active)
                var isAltTabActive = (GetAsyncKeyState(0x12) & 0x8000) != 0; // VK_MENU = 0x12

                // Determine the actual target window
                // If lParam is zero, use foreground window to determine what's actually being activated
                var targetWindow = newActiveWindow != IntPtr.Zero ? newActiveWindow : actualForegroundWindow;

                // Get our window handle to exclude it from consideration
                var helper = new WindowInteropHelper(this);
                var ourWindowHandle = helper.Handle;

                // If target is our own window or still zero, it's likely clicking outside or Alt+Tab
                // In that case, check if foreground is another app
                if (targetWindow == ourWindowHandle || targetWindow == IntPtr.Zero) {
                    if (actualForegroundWindow != IntPtr.Zero &&
                        actualForegroundWindow != ourWindowHandle &&
                        actualForegroundWindow != revitHandle) {
                        // Foreground is another app - user is switching away
                        targetWindow = actualForegroundWindow;
                    }
                }

                // Check if user is switching to a different window (not Revit, not our window)
                var isSwitchingToOtherApp = targetWindow != IntPtr.Zero &&
                                            targetWindow != revitHandle &&
                                            targetWindow != ourWindowHandle;

                // If clicking Revit but it's already the foreground window, don't restore focus
                var isRevitAlreadyForeground = targetWindow == revitHandle && actualForegroundWindow == revitHandle;

                // Don't restore focus if: Alt+Tab is active, switching to another app, or Revit is already foreground
                var shouldRestoreFocus = !isAltTabActive && !isSwitchingToOtherApp && !isRevitAlreadyForeground;

                var actionType = isAltTabActive
                    ? $"Alt+Tab active (target: {this.GetWindowTitle(targetWindow)})"
                    : targetWindow == IntPtr.Zero
                        ? "Click outside (desktop/void)"
                        : targetWindow == revitHandle
                            ? isRevitAlreadyForeground
                                ? "Clicking Revit (already foreground)"
                                : "Switching to Revit"
                            : $"Switching to: {this.GetWindowTitle(targetWindow)}";

                // Use Dispatcher to avoid issues with closing during message processing
                _ = this.Dispatcher.BeginInvoke(new Action(() => {
                    if (!this._isClosing) this.CloseWindow(shouldRestoreFocus);
                }));
            }
        }

        return IntPtr.Zero;
    }

    private string GetWindowTitle(IntPtr hwnd) {
        if (hwnd == IntPtr.Zero) return "null";

        try {
            const int maxLength = 256;
            var title = new StringBuilder(maxLength);
            _ = GetWindowText(hwnd, title, maxLength);
            var titleText = title.ToString();

            if (string.IsNullOrEmpty(titleText)) {
                // Try to get process name instead
                _ = GetWindowThreadProcessId(hwnd, out var processId);
                try {
                    var process = Process.GetProcessById((int)processId);
                    return $"[Process: {process.ProcessName}]";
                } catch {
                    return $"[HWND: {hwnd}]";
                }
            }

            return titleText;
        } catch {
            return $"[HWND: {hwnd}]";
        }
    }

    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    #endregion
}

/// <summary>
///     Event args for close requests
/// </summary>
public class CloseRequestedEventArgs : EventArgs {
    public bool RestoreFocus { get; init; } = true;
}

/// <summary>
///     Interface for UserControls that can request their parent window to close.
/// </summary>
public interface ICloseRequestable {
    event EventHandler<CloseRequestedEventArgs> CloseRequested;
}

/// <summary>
///     Interface for UserControls that can display a title.
/// </summary>
public interface ITitleable {
    void SetTitle(string title);
}