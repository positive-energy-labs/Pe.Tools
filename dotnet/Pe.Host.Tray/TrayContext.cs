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
    /** The window shows as a notice card, not the panel: no focus, card height, the page hides it. */
    private bool _card;
    /** `id:revision` of recent cards: the host replays its last minute on every connect, a card is shown once. */
    private readonly Queue<string> _shownOrder = new();
    private readonly HashSet<string> _shown = new();

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
            if (_window.Visible && !_card) { _window.Hide(); return; }
            ShowPanel();
        };
        _window.Deactivate += (_, _) => HideWindow();
        _window.TaskbarRestarted += (_, _) => { _icon.Visible = false; _icon.Visible = true; };
        _health.Tick += async (_, _) => await CheckHealthAsync();
        _health.Start();
        _window.BeginInvoke(async () => await InitializeWebAsync());
        _ = Task.Run(WatchParentAsync);
        _ = Task.Run(WatchDisposalAsync);
        _ = Task.Run(ReadNoticesAsync);
    }

    private void ShowPanel() {
        _card = false;
        _window.PositionAboveTaskbar();
        _window.Show();
        _window.Activate();
    }

    private void HideWindow() {
        _window.Hide();
        if (!_card) return;
        _card = false;
        _ = RunScriptAsync("window.peNotice?.(null)");
    }

    /** The host's notice feed (`/host/notices`, SSE): each `data:` line is one card. */
    private async Task ReadNoticesAsync() {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        while (!_stop.IsCancellationRequested && !_retired) {
            try {
                using var request = new HttpRequestMessage(HttpMethod.Get, _service.Origin + "/host/notices");
                request.Headers.Add(TokenHeader, _service.Token);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _stop.Token);
                if (response.IsSuccessStatusCode) {
                    using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(_stop.Token));
                    while (await reader.ReadLineAsync(_stop.Token) is { } line)
                        if (line.StartsWith("data: ", StringComparison.Ordinal)) ShowNotice(line[6..]);
                }
            } catch (OperationCanceledException) { return; }
            catch (Exception error) when (error is HttpRequestException or IOException
                                          or System.Text.Json.JsonException) { }
            try { await Task.Delay(2_000, _stop.Token); } catch (OperationCanceledException) { return; }
        }
    }

    private void ShowNotice(string json) {
        // Parsed first, so only a JSON value ever reaches the page as script.
        using var notice = System.Text.Json.JsonDocument.Parse(json);
        var root = notice.RootElement;
        var key = root.GetProperty("id").GetString() + ":" + root.GetProperty("revision").GetInt32();
        if (!_shown.Add(key)) return;
        _shownOrder.Enqueue(key);
        if (_shownOrder.Count > 64) _shown.Remove(_shownOrder.Dequeue());
        var value = root.GetRawText();
        try {
            // ponytail: no page yet means the notice is dropped; the host replays its last minute.
            _window.BeginInvoke(async () => {
                if (!_hasPage) return;
                // A hidden page never lays out, so its card cannot measure itself: show first, then
                // the page's first height report resizes the window. An open panel just shows the card.
                if (!_window.Visible) {
                    _card = true;
                    _window.PositionCard(96);
                    _window.Show();
                }
                await RunScriptAsync($"window.peNotice?.({value})");
            });
        } catch (InvalidOperationException) { }
    }

    private async Task RunScriptAsync(string script) {
        if (_closing || !_ready) return;
        try { await _web.ExecuteScriptAsync(script); }
        catch (Exception error) when (error is InvalidOperationException or COMException) { }
    }

    /** The card's side of the conversation: its height, done, expand to the panel, open a page. */
    private void OnPageMessage(CoreWebView2WebMessageReceivedEventArgs e) {
        if (!IsHostUrl(e.Source)) return;
        using var message = System.Text.Json.JsonDocument.Parse(e.WebMessageAsJson);
        var root = message.RootElement;
        switch (root.GetProperty("kind").GetString()) {
            case "card" when !_window.Visible || _card:
                _card = true;
                _window.PositionCard(root.GetProperty("height").GetInt32());
                _window.Show();
                break;
            case "hide" when _card:
                HideWindow();
                break;
            case "panel":
                ShowPanel();
                break;
            case "open" when root.GetProperty("href").GetString() is { } href && href.StartsWith('/'):
                if (_card) HideWindow();
                OpenWindow(href);
                break;
        }
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
            core.WebMessageReceived += (_, e) => {
                try { OnPageMessage(e); }
                catch (Exception error) when (error is System.Text.Json.JsonException or KeyNotFoundException
                                               or InvalidOperationException or FormatException) { }
            };
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

    private void OpenWindow(string path = "/") {
        if (!IsOriginalService()) return;
        var edge = new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) }
            .Select(root => Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe"))
            .FirstOrDefault(File.Exists);
        try {
            var start = edge is null
                ? new ProcessStartInfo(_service.Origin + path) { UseShellExecute = true }
                : new ProcessStartInfo(edge) { UseShellExecute = false };
            if (edge is not null) {
                start.ArgumentList.Add("--app=" + _service.Origin + path);
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
        DpiChanged += (_, e) => PositionAboveTaskbar(Screen.FromRectangle(e.SuggestedRectangle).WorkingArea,
            e.DeviceDpiNew);
    }

    /** The panel shows with Activate; a notice card never takes focus from Revit. */
    protected override bool ShowWithoutActivation => true;

    /** Panel-wide and as tall as the card says, in CSS pixels, at the taskbar's corner. */
    public void PositionCard(int cssHeight) {
        var work = (Screen.PrimaryScreen ?? Screen.FromPoint(Cursor.Position)).WorkingArea;
        var width = SizeFor(work.Size, DeviceDpi).Width;
        var height = Math.Min((int)Math.Ceiling(cssHeight * DeviceDpi / 96f), work.Height);
        Bounds = new Rectangle(work.Right - width, work.Bottom - height, width, height);
    }

    public void PositionAboveTaskbar() {
        var work = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = work.Location;
        PositionAboveTaskbar(work, DeviceDpi);
    }

    private void PositionAboveTaskbar(Rectangle work, int dpi) {
        var size = SizeFor(work.Size, dpi);
        Bounds = new Rectangle(work.Right - size.Width, work.Bottom - size.Height, size.Width, size.Height);
    }

    internal static Size SizeFor(Size work, int dpi) =>
        new(Math.Min((int)Math.Round(380 * dpi / 96f), work.Width),
            Math.Min((int)Math.Round(700 * dpi / 96f), work.Height));

    protected override void WndProc(ref Message message) {
        if (message.Msg == _taskbarCreated) TaskbarRestarted?.Invoke(this, EventArgs.Empty);
        base.WndProc(ref message);
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);
}
