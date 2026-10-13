using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Pe.Host.Tray;

internal sealed class TrayContext : ApplicationContext {
    private const string TokenHeader = "x-pe-service-token";
    private readonly TrayLaunch _launch;
    private ServiceRecord _service;
    private readonly Process _parent;
    private readonly TrayWindow _window = new();
    private readonly WebView2 _web = new() { Dock = DockStyle.Fill };
    private readonly ContextMenuStrip _menu = new();
    private readonly NotifyIcon _icon;
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false }) {
        Timeout = TimeSpan.FromSeconds(2)
    };
    private readonly System.Windows.Forms.Timer _health = new() { Interval = 3_000 };
    private readonly CancellationTokenSource _stop = new();
    private bool _ready;
    private bool _hasPage;
    private bool _navigating;
    private bool _checking;
    private bool _retired;
    private volatile bool _closing;
    private bool _connected;
    private string? _showRequest;
    private string? _pendingPath;
    private bool _recordDev;
    private readonly ToolStripMenuItem _openWindow = new("Installation unavailable") { Enabled = false };

    public TrayContext(TrayLaunch launch, ServiceRecord service, Process parent) {
        _launch = launch;
        _service = service;
        _parent = parent;
        _pendingPath = launch.Route is { } route ? TrayPath(route) : null;
        _window.Controls.Add(_web);
        _ = _window.Handle;
        var favicon = launch.IsDev ? Path.Combine(launch.SourceRoot!, "ts", "apps", "web", "public", "favicon-dev.ico")
            : Path.Combine(AppContext.BaseDirectory, "..", "web", "client", "favicon.ico");
        _icon = new NotifyIcon {
            Icon = File.Exists(favicon) ? new Icon(favicon) : (Icon)SystemIcons.Application.Clone(),
            Text = $"Pe.Tools {service.Version}", ContextMenuStrip = _menu, Visible = true
        };
        if (launch.IsDev) { _window.Text = "Pe.Tools Dev · " + Path.GetFileName(launch.SourceRoot); _window.Icon = _icon.Icon; }
        _openWindow.Click += (_, _) => OpenWindow();
        _menu.Items.Add(_openWindow);
        _menu.Opening += async (_, _) => await RefreshPwaMenuAsync();
        _menu.Items.Add("Quit host", null, async (_, _) => await QuitHostAsync());
        _icon.MouseClick += (_, e) => {
            if (e.Button != MouseButtons.Left) return;
            if (!_ready) { _menu.Show(Cursor.Position); return; }
            if (_window.Visible && _window.WindowState != FormWindowState.Minimized) { _window.Hide(); return; }
            RequestShow(null);
        };
        _window.FormClosing += (_, e) => {
            if (_closing || e.CloseReason != CloseReason.UserClosing) return;
            e.Cancel = true;
            _window.Hide();
        };
        _window.TaskbarRestarted += (_, _) => { _icon.Visible = false; _icon.Visible = true; };
        _window.TitlebarGeometryChanged += (_, _) => PostTitlebarGeometry();
        _health.Tick += async (_, _) => await CheckHealthAsync();
        _health.Start();
        if (_launch.ShowOnStart) RequestShow(null);
        _window.BeginInvoke(async () => await InitializeWebAsync());
        _ = Task.Run(WatchParentAsync);
        _ = Task.Run(WatchDisposalAsync);
    }

    private async Task WatchParentAsync() {
        try {
            await _parent.WaitForExitAsync(_stop.Token);
            ExitOnUiThread();
        } catch (OperationCanceledException) { }
    }

    private static string TrayPath(string route) {
        var parts = route.Split('#', 2);
        return parts[0] + (parts[0].Contains('?') ? "&" : "?") + "shell=tray"
            + (parts.Length == 2 ? "#" + parts[1] : "");
    }

    public void RequestShow(string? route) {
        if (_closing) return;
        _window.BeginInvoke(() => {
            if (_closing || !IsOriginalService()) return;
            if (route is not null) {
                _pendingPath = TrayPath(route);
                _hasPage = false;
                if (_ready && _connected) _web.CoreWebView2.Navigate(_service.ViewOrigin + _pendingPath);
            }
            _window.PositionAboveTaskbar();
            _window.WindowState = FormWindowState.Normal;
            _window.Show();
            _window.Activate();
        });
    }

    private async Task WatchDisposalAsync() {
        // Host disposal closes stdin; parent death is independently watched even if that pipe is wedged.
        try {
            await Console.In.ReadLineAsync(_stop.Token);
            ExitOnUiThread();
        } catch (OperationCanceledException) { }
        catch (IOException) { ExitOnUiThread(); }
    }

    private void ExitOnUiThread() {
        try {
            if (!_closing) _window.BeginInvoke(ExitThread);
        } catch (InvalidOperationException) { }
    }

    private bool IsOriginalService() {
        if (_retired) return false;
        try {
            if (!_parent.HasExited) {
                var current = _launch.ReadService();
                if (_launch.IsDev) {
                    if (current != _service) {
                        if (_ready && _web.Source is { } source && IsViewUrl(source.AbsoluteUri))
                            _pendingPath = source.PathAndQuery;
                        _service = current; _hasPage = false;
                    }
                    return true;
                }
                if (current == _service) return true;
            }
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException
                                       or System.Text.Json.JsonException or FormatException
                                       or InvalidOperationException or KeyNotFoundException or ArgumentException
                                       or System.ComponentModel.Win32Exception) { }
        // Never rediscover or adopt a successor, even when it reuses the same loopback port.
        _retired = !_launch.IsDev;
        return false;
    }

    private async Task InitializeWebAsync() {
        try {
            DevStage("environment");
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Positive Energy", "Pe.Tools", "tray-webview");
            if (_launch.IsDev) profile = Path.Combine(profile, _launch.ProfileKey);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            DevStage("controller");
            if (_closing) return;
            await _web.EnsureCoreWebView2Async(environment);
            DevStage("ready");
            if (_closing) return;
            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;
            core.Settings.IsNonClientRegionSupportEnabled = true;
            _window.ConfigureTitlebar(_web);
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += (_, e) => {
                var current = IsOriginalService();
                if (!IsHostUrl(e.Request.Uri)) {
                    e.Request.Headers.RemoveHeader(TokenHeader);
                    return;
                }
                if (current) e.Request.Headers.SetHeader(TokenHeader, _service.Token);
                else e.Response = environment.CreateWebResourceResponse(null, 503, "Parent service retired", "");
            };
            core.NavigationStarting += (_, e) => {
                if (!IsOriginalService() || !IsViewUrl(e.Uri)) e.Cancel = true;
                else _navigating = true;
            };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.WebMessageReceived += (_, e) => {
                if (!IsOriginalService() || !IsViewUrl(e.Source)) return;
                try {
                    using var message = JsonDocument.Parse(e.TryGetWebMessageAsString());
                    var payload = message.RootElement;
                    if (payload.ValueKind == JsonValueKind.Object
                        && payload.TryGetProperty("type", out var readyType) && readyType.ValueKind == JsonValueKind.String
                        && readyType.GetString() == "chrome-ready") { PostTitlebarGeometry(); return; }
                    if (payload.ValueKind == JsonValueKind.Object
                        && payload.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String
                        && type.GetString() == "open-window"
                        && payload.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String
                        && TryGetWindowUrl(url.GetString()!, _service.ViewOrigin, out var destination))
                        OpenWindow(destination);
                    else if (TrayWindow.TryReadChromeTheme(payload, out var background, out var foreground, out var dark)) {
                        _window.ApplyChromeTheme(background, foreground, dark);
                        _recordDev = true;
                    }
                } catch (Exception error) when (error is JsonException or InvalidOperationException or COMException) { }
            };
            core.NavigationCompleted += async (_, e) => {
                _navigating = false;
                _hasPage |= e.IsSuccess;
                _recordDev |= e.IsSuccess;
                if (e.IsSuccess) _pendingPath = null;
                if (!e.IsSuccess) _connected = false;
                if (e.IsSuccess) PostTitlebarGeometry();
                await ShowConnectionAsync();
                if (_launch.IsDev && e.IsSuccess) await RecordDevStateAsync();
            };
            _ready = true;
            await CheckHealthAsync();
        } catch (Exception error) when (error is WebView2RuntimeNotFoundException or COMException
                                       or InvalidOperationException or IOException or UnauthorizedAccessException) {
            if (_closing) return;
            _ready = false;
            DevStage("unavailable: " + error.Message);
            _icon.Text = "Pe.Tools: WebView2 unavailable";
        }
    }

    private void DevStage(string stage) {
        if (!_launch.IsDev) return;
        try { File.WriteAllText(Path.Combine(_launch.SourceRoot!, ".artifacts", "dev-tray", "boot.json"),
            JsonSerializer.Serialize(new { stage, pid = Environment.ProcessId, when = DateTime.UtcNow })); }
        catch (IOException) { }
    }

    private void PostTitlebarGeometry() {
        if (!_ready || _closing || !IsOriginalService() || _web.Source is not { } source || !IsViewUrl(source.AbsoluteUri)) return;
        try { _web.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(_window.ReadTitlebarGeometry())); }
        catch (Exception error) when (error is InvalidOperationException or COMException) { }
    }

    private bool IsHostUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == _service.Origin;
    private bool IsViewUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == _service.ViewOrigin;

    private async Task CheckHealthAsync() {
        if (_closing || _checking) return;
        var show = _launch.ReadShowRequest();
        if (show is not null && show != _showRequest && !_parent.HasExited) {
            _showRequest = show;
            _recordDev = true;
            RequestShow(null);
        }
        _checking = true;
        try {
            _connected = false;
            if (IsOriginalService()) {
                var service = _service;
                using var request = new HttpRequestMessage(HttpMethod.Get, _service.Origin + _service.Health);
                request.Headers.Add(TokenHeader, _service.Token);
                using var response = await _http.SendAsync(request, _stop.Token);
                _connected = response.IsSuccessStatusCode && IsOriginalService() && service == _service;
            }
        } catch (Exception error) when (error is HttpRequestException or OperationCanceledException) {
            _connected = false;
        } finally {
            _checking = false;
        }
        if (!_closing) {
            // The claim can precede HTTP route readiness. Retry only until the first page arrives.
            if (_ready && _connected && !_hasPage && !_navigating) {
                var path = _pendingPath ?? (_web.Source is { } source && IsViewUrl(source.AbsoluteUri)
                    ? source.PathAndQuery : "/open?shell=tray");
                DevStage("navigate " + _service.ViewOrigin + path);
                _web.CoreWebView2.Navigate(_service.ViewOrigin + path);
            }
            await ShowConnectionAsync();
            if (_launch.IsDev && _ready && _recordDev) { _recordDev = false; await RecordDevStateAsync(); }
        }
    }

    private async Task ShowConnectionAsync() {
        if (_closing || !_ready) return;
        _icon.Text = _connected ? $"Pe.Tools {(_launch.IsDev ? "DEV" : _service.Version)}" : "Pe.Tools: disconnected";
        _web.Enabled = _connected;
        // Keep the host-rendered page in place; this shell only marks its transport as stale.
        try {
            await _web.ExecuteScriptAsync($$"""
                (() => {
                    let status = document.getElementById('pe-tray-disconnected');
                    if (!status) {
                        status = document.createElement('div');
                        status.id = 'pe-tray-disconnected';
                        status.setAttribute('role', 'status');
                        status.setAttribute('data-tone', 'alarm');
                        status.setAttribute('data-surface', 'artifact');
                        status.className = 't-value';
                        status.style.cssText = 'position:fixed;inset:0 0 auto;z-index:2147483647;padding:var(--gutter,8px);background:var(--pe-artifact);color:var(--pe-alarm)';
                        status.textContent = 'Disconnected — last page retained';
                        document.body.append(status);
                    }
                    status.hidden = {{(_connected ? "true" : "false")}};
                })()
                """);
        } catch (Exception error) when (error is InvalidOperationException or COMException) { }
    }

    private async Task RecordDevStateAsync() {
        try {
            var geometry = JsonSerializer.Deserialize<string>(await _web.ExecuteScriptAsync("JSON.stringify({href:location.href,title:document.title,shell:document.querySelector('nav[data-shell]')?.getAttribute('data-shell'),body:document.body.innerText.slice(0,500),readyState:document.readyState,overflow:document.documentElement.scrollWidth>innerWidth,devIcon:document.querySelector('link[rel~=icon]')?.href,overlay:!!navigator.windowControlsOverlay,overlayVisible:navigator.windowControlsOverlay?.visible,dpr:devicePixelRatio,width:innerWidth,height:innerHeight})"));
            var directory = Path.Combine(_launch.SourceRoot!, ".artifacts", "dev-tray");
            File.WriteAllText(Path.Combine(directory, "native.json"), JsonSerializer.Serialize(new {
                pid = Environment.ProcessId, parentPid = _launch.ParentPid, sourceRoot = _launch.SourceRoot,
                runtime = _web.CoreWebView2.Environment.BrowserVersionString, frontend = _service.ViewOrigin,
                backend = _service.Origin, instanceId = _service.InstanceId, connected = _connected,
                windowVisible = _window.Visible, profile = _launch.ProfileKey, geometry = JsonSerializer.Deserialize<JsonElement>(geometry!),
                captionTheme = _window.ChromeThemeResult,
                nativeTitlebar = _window.ReadTitlebarGeometry(),
                when = DateTime.UtcNow
            }));
            if (_window.Visible) {
                using var bitmap = new Bitmap(_window.Width, _window.Height);
                using var graphics = Graphics.FromImage(bitmap);
                var dc = graphics.GetHdc();
                try { PrintWindow(_window.Handle, dc, 2); } finally { graphics.ReleaseHdc(dc); }
                bitmap.Save(Path.Combine(directory, "native-window.png"));
                graphics.CopyFromScreen(_window.Location, Point.Empty, _window.Size);
                bitmap.Save(Path.Combine(directory, "native-visible.png"));
            }
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or ExternalException
                                       or InvalidOperationException or ArgumentException or System.ComponentModel.Win32Exception) { }
    }

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr window, IntPtr deviceContext, uint flags);

    internal static bool TryGetWindowUrl(string value, string origin, out string destination) {
        destination = "";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.GetLeftPart(UriPartial.Authority) != origin || uri.UserInfo.Length != 0) return false;
        var query = uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries);
        var kept = new List<string>();
        foreach (var item in query) {
            var key = Uri.UnescapeDataString(item.Split('=', 2)[0]);
            if (key.Equals("shell", StringComparison.OrdinalIgnoreCase)) continue;
            if (key.Equals("token", StringComparison.OrdinalIgnoreCase)
                || key.Equals("serviceToken", StringComparison.OrdinalIgnoreCase)
                || key.Equals(TokenHeader, StringComparison.OrdinalIgnoreCase)) return false;
            kept.Add(item);
        }
        destination = uri.GetLeftPart(UriPartial.Path)
            + (kept.Count == 0 ? "" : "?" + string.Join('&', kept)) + uri.Fragment;
        return true;
    }

    private async Task<InstalledPwa?> FindPwaAsync() {
        if (!IsOriginalService()) throw new InvalidOperationException("Parent service unavailable");
        var service = _service;
        // The resolver uses its own token-free frontend client.
        var installed = await PwaLauncher.ResolveAsync(service.ViewOrigin, _stop.Token);
        if (!IsOriginalService() || service != _service) throw new InvalidOperationException("Parent service changed");
        return installed;
    }

    private async Task RefreshPwaMenuAsync() {
        _openWindow.Enabled = false;
        try { _openWindow.Text = await FindPwaAsync() is null ? "Install to taskbar" : "Open window"; _openWindow.Enabled = true; }
        catch (Exception error) when (error is IOException or HttpRequestException or JsonException or UnauthorizedAccessException
                                       or ArgumentException or OperationCanceledException or System.Security.SecurityException or InvalidOperationException) {
            _openWindow.Text = "Installation unavailable";
        }
    }

    private async void OpenWindow(string? destination = null) {
        if (!IsOriginalService()) return;
        var service = _service;
        destination ??= _service.ViewOrigin + "/";
        try {
            if (PwaLauncher.EdgeExecutable is not { } edge) { _icon.Text = "Pe.Tools: Edge unavailable"; return; }
            var installed = await FindPwaAsync();
            if (!IsOriginalService() || service != _service) return;
            _openWindow.Text = installed is null ? "Install in Edge" : "Open window";
            var start = PwaLauncher.Launch(edge, service.ViewOrigin, destination, installed, PwaLauncher.StandardProfileRoot);
            Process.Start(start)?.Dispose();
        } catch (Exception error) when (error is System.ComponentModel.Win32Exception or IOException or HttpRequestException
                                       or JsonException or UnauthorizedAccessException or ArgumentException or OperationCanceledException
                                       or System.Security.SecurityException or InvalidOperationException) {
            if (!_closing) _icon.Text = "Pe.Tools: cannot open window";
        }
    }

    private async Task QuitHostAsync() {
        if (!IsOriginalService()) return;
        try {
            using var request = new HttpRequestMessage(HttpMethod.Post, _service.Origin + "/admin/shutdown");
            request.Headers.Add(TokenHeader, _service.Token);
            using var response = await _http.SendAsync(request, _stop.Token);
            if (!response.IsSuccessStatusCode) _icon.Text = "Pe.Tools: shutdown refused";
        } catch (Exception error) when (error is HttpRequestException or OperationCanceledException) {
            if (!_closing) _icon.Text = "Pe.Tools: shutdown unavailable";
        }
    }

    protected override void Dispose(bool disposing) {
        if (disposing && !_closing) {
            _closing = true;
            _stop.Cancel();
            _health.Dispose();
            _icon.Visible = false;
            var icon = _icon.Icon;
            _icon.Dispose();
            icon?.Dispose();
            _menu.Dispose();
            _window.Dispose();
            _http.Dispose();
            _stop.Dispose();
        }
        base.Dispose(disposing);
    }

    protected override void ExitThreadCore() {
        Dispose();
        base.ExitThreadCore();
    }
}

internal sealed class TrayWindow : Form {
    private readonly uint _taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    private bool _positioned;
    public event EventHandler? TaskbarRestarted;
    internal CaptionThemeResult? ChromeThemeResult { get; private set; }
    private WebView2? _frameView;
    private bool _customFrame;
    private bool _refreshingFrame;
    public event EventHandler? TitlebarGeometryChanged;

    internal void ConfigureTitlebar(WebView2 view) {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10) || DwmIsCompositionEnabled(out var enabled) != 0 || !enabled) return;
        _frameView = view; _customFrame = true; BackColor = Color.Black;
        var policy = 2;
        DwmSetWindowAttribute(Handle, 2, ref policy, sizeof(int));
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x37); // NOMOVE|NOSIZE|NOZORDER|NOACTIVATE|FRAMECHANGED
        var margins = new NativeMargins { Top = (int)Math.Round(40 * DeviceDpi / 96d) };
        DwmExtendFrameIntoClientArea(Handle, ref margins);
        SizeChanged += (_, _) => RefreshTitlebar();
        VisibleChanged += (_, _) => RefreshTitlebar();
        DpiChanged += (_, _) => RefreshTitlebar();
        RefreshTitlebar();
    }

    internal NativeTitlebarGeometry ReadTitlebarGeometry() {
        if (!_customFrame || !Visible || WindowState == FormWindowState.Minimized
            || DwmGetWindowAttribute(Handle, 5, out NativeRect bounds, Marshal.SizeOf<NativeRect>()) != 0)
            return NativeTitlebarGeometry.Hidden;
        return ProjectTitlebar(new Rectangle(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top),
            ClientSize, DeviceDpi, Visible);
    }

    internal static NativeTitlebarGeometry ProjectTitlebar(Rectangle buttons, Size client, int dpi, bool visible) {
        if (!visible || dpi <= 0 || client.Width <= 0 || client.Height <= 0 || buttons.Left <= 0 || buttons.Top < 0
            || buttons.Width <= 0 || buttons.Height <= 0 || buttons.Right > client.Width || buttons.Bottom > client.Height)
            return NativeTitlebarGeometry.Hidden;
        var scale = dpi / 96d;
        return new("titlebar-geometry", true, new(0, 0, buttons.Left / scale, buttons.Bottom / scale));
    }

    private int ResizeBorder => GetSystemMetricsForDpi(32, (uint)DeviceDpi) + GetSystemMetricsForDpi(92, (uint)DeviceDpi);
    // The resize hit-test margin is wider than the painted border. Clipping to it would cut off HTML controls.
    private int VisibleFrameBorder => OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)
        && DwmGetWindowAttribute(Handle, 37, out uint border, sizeof(uint)) == 0 && border is > 0 and <= 16
        ? (int)border : Math.Max(1, (int)Math.Round(DeviceDpi / 96d));
    internal static Rectangle ContentClipBounds(Size client, int border) =>
        new(border, border, Math.Max(0, client.Width - border * 2), Math.Max(0, client.Height - border * 2));

    private void RefreshTitlebar() {
        if (_frameView is null || _refreshingFrame) return;
        _refreshingFrame = true;
        try {
            var geometry = ReadTitlebarGeometry();
            Region? next = null;
            if (geometry.visible) {
                next = new Region(ContentClipBounds(ClientSize, VisibleFrameBorder));
                var scale = DeviceDpi / 96d;
                next.Exclude(new Rectangle((int)Math.Round(geometry.rect.width * scale), 0,
                    ClientSize.Width - (int)Math.Round(geometry.rect.width * scale), (int)Math.Ceiling(geometry.rect.height * scale)));
            }
            var old = _frameView.Region; _frameView.Region = next; old?.Dispose();
            TitlebarGeometryChanged?.Invoke(this, EventArgs.Empty);
        } finally { _refreshingFrame = false; }
    }

    public TrayWindow() {
        FormBorderStyle = FormBorderStyle.Sizable;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Text = "Pe.Tools";
        DpiChanged += (_, e) => PositionAboveTaskbar(Screen.FromRectangle(e.SuggestedRectangle).WorkingArea,
            e.DeviceDpiNew);
    }

    public void PositionAboveTaskbar() {
        if (_positioned && Screen.FromRectangle(Bounds).WorkingArea.Contains(Bounds)) return;
        var work = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = work.Location;
        PositionAboveTaskbar(work, DeviceDpi);
    }

    private void PositionAboveTaskbar(Rectangle work, int dpi) {
        var size = SizeFor(work.Size, dpi);
        Bounds = new Rectangle(work.Right - size.Width, work.Bottom - size.Height, size.Width, size.Height);
        _positioned = true;
    }

    internal static Size SizeFor(Size work, int dpi) =>
        new(Math.Min((int)Math.Round(760 * dpi / 96f), work.Width),
            Math.Min((int)Math.Round(560 * dpi / 96f), work.Height));

    internal static bool TryReadChromeTheme(JsonElement payload, out int background, out int foreground, out bool dark) {
        background = foreground = 0; dark = false;
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String
            || type.GetString() != "chrome-theme"
            || !payload.TryGetProperty("background", out var bg) || bg.ValueKind != JsonValueKind.Number
            || !bg.TryGetInt32(out background) || background is < 0 or > 0xFFFFFF
            || !payload.TryGetProperty("foreground", out var fg) || fg.ValueKind != JsonValueKind.Number
            || !fg.TryGetInt32(out foreground) || foreground is < 0 or > 0xFFFFFF
            || !payload.TryGetProperty("dark", out var mode) || mode.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            return false;
        dark = mode.GetBoolean();
        return true;
    }

    public void ApplyChromeTheme(int background, int foreground, bool dark) {
        if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;
        // DWM owns the caption and its system controls; colors are COLORREF (0x00bbggrr).
        try {
            var darkMode = dark ? 1 : 0;
            ChromeThemeResult = new CaptionThemeResult(
                DwmSetWindowAttribute(Handle, 20, ref darkMode, sizeof(int)),
                DwmSetWindowAttribute(Handle, 35, ref background, sizeof(int)),
                DwmSetWindowAttribute(Handle, 36, ref foreground, sizeof(int)));
        } catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException or ExternalException) { }
    }

    protected override void WndProc(ref Message message) {
        if (message.Msg == _taskbarCreated) TaskbarRestarted?.Invoke(this, EventArgs.Empty);
        if (_customFrame) {
            if (DwmDefWindowProc(message.HWnd, (uint)message.Msg, message.WParam, message.LParam, out var result)) { message.Result = result; return; }
            if (message.Msg == 0x83 && message.WParam != IntPtr.Zero) { message.Result = IntPtr.Zero; return; }
            if (message.Msg == 6) { var margins = new NativeMargins { Top = Math.Max(ResizeBorder, (int)Math.Round(40 * DeviceDpi / 96d)) }; DwmExtendFrameIntoClientArea(Handle, ref margins); }
            if (message.Msg == 0x84 && WindowState != FormWindowState.Maximized) {
                var packed = message.LParam.ToInt64();
                var p = PointToClient(new Point((short)(packed & 65535), (short)((packed >> 16) & 65535)));
                var edge = ResizeBorder; var left = p.X < edge; var right = p.X >= ClientSize.Width - edge;
                var top = p.Y < edge; var bottom = p.Y >= ClientSize.Height - edge;
                var hit = top ? (left ? 13 : right ? 14 : 12) : bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 1;
                if (hit != 1) { message.Result = (IntPtr)hit; return; }
            }
        }
        base.WndProc(ref message);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, uint attribute, ref int value, int size);
    [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct NativeMargins { public int Left, Right, Top, Bottom; }
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out NativeRect value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out uint value, int size);
    [DllImport("dwmapi.dll")] private static extern int DwmExtendFrameIntoClientArea(IntPtr window, ref NativeMargins margins);
    [DllImport("dwmapi.dll")] private static extern bool DwmDefWindowProc(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, out IntPtr result);
    [DllImport("dwmapi.dll")] private static extern int DwmIsCompositionEnabled(out bool enabled);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern int GetSystemMetricsForDpi(int index, uint dpi);
}

internal sealed record CaptionThemeResult(int ImmersiveDarkMode, int CaptionColor, int TextColor);
internal sealed record NativeTitlebarRect(double x, double y, double width, double height);
internal sealed record NativeTitlebarGeometry(string type, bool visible, NativeTitlebarRect rect) {
    internal static readonly NativeTitlebarGeometry Hidden = new("titlebar-geometry", false, new(0, 0, 0, 0));
}
