using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Pe.Host.Tray;

internal sealed class TrayContext : ApplicationContext {
    private const string TokenHeader = "x-pe-service-token";
    private readonly TrayLaunch _launch;
    private readonly ServiceRecord _service;
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

    public TrayContext(TrayLaunch launch, ServiceRecord service, Process parent) {
        _launch = launch;
        _service = service;
        _parent = parent;
        _window.Controls.Add(_web);
        _ = _window.Handle;
        var favicon = Path.Combine(AppContext.BaseDirectory, "..", "web", "client", "favicon.ico");
        _icon = new NotifyIcon {
            Icon = File.Exists(favicon) ? new Icon(favicon) : (Icon)SystemIcons.Application.Clone(),
            Text = $"Pe.Tools {service.Version}", ContextMenuStrip = _menu, Visible = true
        };
        _menu.Items.Add("Open window", null, (_, _) => OpenWindow());
        _menu.Items.Add("Quit host", null, async (_, _) => await QuitHostAsync());
        _icon.MouseClick += (_, e) => {
            if (e.Button != MouseButtons.Left) return;
            if (!_ready) { _menu.Show(Cursor.Position); return; }
            if (_window.Visible) { _window.Hide(); return; }
            _window.PositionAboveTaskbar();
            _window.Show();
            _window.Activate();
        };
        _window.Deactivate += (_, _) => _window.Hide();
        _window.TaskbarRestarted += (_, _) => { _icon.Visible = false; _icon.Visible = true; };
        _health.Tick += async (_, _) => await CheckHealthAsync();
        _health.Start();
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
            if (!_parent.HasExited && _launch.ReadService() == _service) return true;
        } catch (Exception error) when (error is IOException or UnauthorizedAccessException or InvalidDataException
                                       or System.Text.Json.JsonException or FormatException
                                       or InvalidOperationException or KeyNotFoundException) { }
        // Never rediscover or adopt a successor, even when it reuses the same loopback port.
        _retired = true;
        return false;
    }

    private async Task InitializeWebAsync() {
        try {
            _ = CoreWebView2Environment.GetAvailableBrowserVersionString();
            var profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Positive Energy", "Pe.Tools", "tray-webview");
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            if (_closing) return;
            await _web.EnsureCoreWebView2Async(environment);
            if (_closing) return;
            var core = _web.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsBuiltInErrorPageEnabled = false;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
                CoreWebView2WebResourceRequestSourceKinds.All);
            core.WebResourceRequested += (_, e) => {
                if (!IsHostUrl(e.Request.Uri)) {
                    e.Request.Headers.RemoveHeader(TokenHeader);
                    return;
                }
                if (IsOriginalService()) e.Request.Headers.SetHeader(TokenHeader, _service.Token);
                else e.Response = environment.CreateWebResourceResponse(null, 503, "Parent service retired", "");
            };
            core.NavigationStarting += (_, e) => {
                if (!IsHostUrl(e.Uri) || !IsOriginalService()) e.Cancel = true;
                else _navigating = true;
            };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.NavigationCompleted += async (_, e) => {
                _navigating = false;
                _hasPage |= e.IsSuccess;
                if (!e.IsSuccess) _connected = false;
                await ShowConnectionAsync();
            };
            _ready = true;
            await CheckHealthAsync();
        } catch (Exception error) when (error is WebView2RuntimeNotFoundException or COMException
                                       or InvalidOperationException or IOException or UnauthorizedAccessException) {
            if (_closing) return;
            _ready = false;
            _icon.Text = "Pe.Tools: WebView2 unavailable";
        }
    }

    private bool IsHostUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == _service.Origin;

    private async Task CheckHealthAsync() {
        if (_closing || _checking) return;
        _checking = true;
        try {
            _connected = false;
            if (IsOriginalService()) {
                using var request = new HttpRequestMessage(HttpMethod.Get, _service.Origin + _service.Health);
                request.Headers.Add(TokenHeader, _service.Token);
                using var response = await _http.SendAsync(request, _stop.Token);
                _connected = response.IsSuccessStatusCode && IsOriginalService();
            }
        } catch (Exception error) when (error is HttpRequestException or OperationCanceledException) {
            _connected = false;
        } finally {
            _checking = false;
        }
        if (!_closing) {
            // The claim can precede HTTP route readiness. Retry only until the first page arrives.
            if (_ready && _connected && !_hasPage && !_navigating)
                _web.CoreWebView2.Navigate(_service.Origin + "/machine?shell=tray");
            await ShowConnectionAsync();
        }
    }

    private async Task ShowConnectionAsync() {
        if (_closing || !_ready) return;
        _icon.Text = _connected ? $"Pe.Tools {_service.Version}" : "Pe.Tools: disconnected";
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

    private void OpenWindow() {
        if (!IsOriginalService()) return;
        var edge = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) }
            .Select(root => Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"))
            .FirstOrDefault(File.Exists);
        try {
            var start = edge is null
                ? new ProcessStartInfo(_service.Origin + "/") { UseShellExecute = true }
                : new ProcessStartInfo(edge) { UseShellExecute = false };
            if (edge is not null) {
                start.ArgumentList.Add("--app=" + _service.Origin + "/");
                start.ArgumentList.Add("--user-data-dir=" + Path.Combine(Path.GetDirectoryName(
                    Path.GetDirectoryName(Path.GetDirectoryName(_launch.ServiceFile)))!, "edge-app"));
                start.ArgumentList.Add("--no-first-run");
            }
            Process.Start(start)?.Dispose();
        } catch (System.ComponentModel.Win32Exception) { _icon.Text = "Pe.Tools: cannot open window"; }
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
    public event EventHandler? TaskbarRestarted;

    public TrayWindow() {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Text = "Pe.Tools machine";
    }

    public void PositionAboveTaskbar() {
        var work = Screen.FromPoint(Cursor.Position).WorkingArea;
        Size = new Size(Math.Min(380, work.Width), Math.Min(700, work.Height));
        Location = new Point(work.Right - Width, work.Bottom - Height);
    }

    protected override void WndProc(ref Message message) {
        if (message.Msg == _taskbarCreated) TaskbarRestarted?.Invoke(this, EventArgs.Empty);
        base.WndProc(ref message);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);
}
