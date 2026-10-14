using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.WinForms;

namespace Pe.Host.Tray;

/** An independent, non-activating receipt window anchored to the primary taskbar. */
internal sealed class NoticeWindow : Form {
    private WebView2? _view;
    private int _cssHeight = 96;

    public NoticeWindow() {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Text = "Pe.Tools notice";
        BackColor = Color.Black;
        DpiChanged += (_, e) => { e.Cancel = true; PositionCard(_cssHeight); };
        SizeChanged += (_, _) => RefreshFrame();
    }

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams {
        get {
            var parameters = base.CreateParams;
            parameters.Style |= 0x40000; // WS_THICKFRAME lets DWM draw the frame and shadow.
            parameters.ExStyle |= 0x80; // WS_EX_TOOLWINDOW excludes Alt+Tab as well as the taskbar.
            return parameters;
        }
    }

    public void PositionCard(int cssHeight) {
        _cssHeight = cssHeight;
        var screen = Screen.PrimaryScreen ?? Screen.FromPoint(Cursor.Position);
        // Move to the taskbar monitor before reading DPI; the panel can be on another monitor.
        if (Screen.FromRectangle(Bounds).DeviceName != screen.DeviceName) Location = screen.WorkingArea.Location;
        Bounds = CardBoundsFor(screen.WorkingArea, DeviceDpi, cssHeight);
    }

    internal static Rectangle CardBoundsFor(Rectangle work, int dpi, int cssHeight) {
        var gutter = Math.Max(0, (int)Math.Round(20 * dpi / 96d));
        var width = Math.Min((int)Math.Round(420 * dpi / 96d), Math.Max(0, work.Width - 2 * gutter));
        var height = Math.Min((int)Math.Ceiling(cssHeight * dpi / 96d), Math.Max(0, work.Height - 2 * gutter));
        return new Rectangle(work.Right - gutter - width, work.Bottom - gutter - height, width, height);
    }

    internal void ConfigureFrame(WebView2 view) {
        _view = view;
        var policy = 2;
        DwmSetWindowAttribute(Handle, 2, ref policy, sizeof(int));
        var round = 2;
        DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        RefreshFrame();
    }

    private void RefreshFrame() {
        if (_view is null) return;
        var margins = new Margins { Left = 1, Right = 1, Top = 1, Bottom = 1 };
        DwmExtendFrameIntoClientArea(Handle, ref margins);
        var border = Math.Max(1, (int)Math.Round(DeviceDpi / 96d));
        var old = _view.Region;
        _view.Region = new Region(TrayWindow.ContentClipBounds(ClientSize, border));
        old?.Dispose();
    }

    protected override void WndProc(ref Message message) {
        // Keep DWM's non-client edge without a caption or resize hit targets on the card.
        if (message.Msg == 0x83 && message.WParam != IntPtr.Zero) { message.Result = IntPtr.Zero; return; }
        if (message.Msg == 0x84) { message.Result = (IntPtr)1; return; }
        base.WndProc(ref message);
    }

    [StructLayout(LayoutKind.Sequential)] private struct Margins { public int Left, Right, Top, Bottom; }
    [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window, uint attribute, ref int value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref Margins margins);
}
