using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Pe.Shared.Product;

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
    private bool _rendererReady;
    private bool _hasPage;
    private bool _navigating;
    private bool _checking;
    private bool _retired;
    private volatile bool _closing;
    /** The person asked the host to stop: its exit is a quit, not an update to come back from. */
    private volatile bool _quitRequested;
    private bool _connected;
    private string? _showRequest;
    private string? _pendingPath;
    private bool _recordDev;
    private readonly ToolStripMenuItem _openWindow = new("Installation unavailable") { Enabled = false };
    private readonly NoticeWindow _noticeWindow = new();
    private readonly WebView2 _noticeWeb = new() { Dock = DockStyle.Fill };
    private bool _noticeHasPage;
    private bool _noticeNavigating;
    private readonly NoticeInbox _inbox;

    public TrayContext(TrayLaunch launch, ServiceRecord service, Process parent) {
        _launch = launch;
        _inbox = new NoticeInbox(NoticeCursor.Load(NoticeCursorPath(launch)), id => NoticeCursor.Save(NoticeCursorPath(launch), id));
        _service = service;
        _parent = parent;
        // No route asked for: a predecessor tray that went away with its host left where the person was.
        var resumed = launch.Route is null ? TrayResume.Take(ResumePath, DateTimeOffset.UtcNow) : null;
        _pendingPath = (launch.Route ?? resumed) is { } route ? TrayPath(route) : null;
        _window.Controls.Add(_web);
        _noticeWindow.Controls.Add(_noticeWeb);
        _ = _noticeWindow.Handle;
        _ = _window.Handle;
        var favicon = launch.IsDev ? Path.Combine(launch.SourceRoot!, "ts", "apps", "web", "public", "favicon-dev.ico")
            : Path.Combine(AppContext.BaseDirectory, "..", "web", "client", "favicon.ico");
        _icon = new NotifyIcon {
            Icon = File.Exists(favicon) ? new Icon(favicon) : (Icon)SystemIcons.Application.Clone(),
            Text = $"Pe.Tools {service.Version}", ContextMenuStrip = _menu, Visible = true
        };
        if (launch.IsDev) { _window.Text = "Pe.Tools Dev · " + Path.GetFileName(launch.SourceRoot); _window.Icon = _icon.Icon; }
        _openWindow.Click += (_, _) => OpenWindow(install: true);
        _menu.Items.Add(_openWindow);
        _menu.Items.Add("Rehome", null, (_, _) => {
            _window.Rehome();
            _window.WindowState = FormWindowState.Normal;
            _window.Show();
            _window.Activate();
        });
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
        if (_launch.ShowOnStart || resumed is not null) RequestShow(null);
        _window.BeginInvoke(async () => await InitializeWebAsync());
        _ = Task.Run(WatchParentAsync);
        _ = Task.Run(WatchDisposalAsync);
        _ = Task.Run(ReadNoticesAsync);
    }

    /** Under the product's one machine-local root, which `PE_TOOLS_PRODUCT_HOME` moves. */
    internal static string WebViewProfileRoot => Path.Combine(ProductRuntimeLayout.ForCurrentUser().RootPath, "tray-webview");

    private async Task WatchParentAsync() {
        try {
            await _parent.WaitForExitAsync(_stop.Token);
            // An update replaces the host and its tray: leave the route the window was showing for the successor.
            try {
                if (!_closing) _window.BeginInvoke(() => { RememberWhereTheWindowWas(); ExitThread(); });
            } catch (InvalidOperationException) { }
        } catch (OperationCanceledException) { }
    }

    private string ResumePath => Path.Combine(ProductRuntimeLayout.ForCurrentUser().RootPath, $"tray-resume-{_launch.ProfileKey}.json");

    private void RememberWhereTheWindowWas() {
        if (_quitRequested || !_ready || !_window.Visible || _window.WindowState == FormWindowState.Minimized
            || _web.Source is not { } source || !IsViewUrl(source.AbsoluteUri)) return;
        TrayResume.Save(ResumePath, TrayResume.RouteOf(source), DateTimeOffset.UtcNow);
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

    private void HideCard() {
        _noticeWindow.Hide();
        if (_noticeWeb.CoreWebView2 is not null)
            PostNoticeMessage(new { type = "notice", notice = (object?)null });
    }

    private static string NoticeCursorPath(TrayLaunch launch) => Path.Combine(ProductRuntimeLayout.ForCurrentUser().RootPath, $"tray-notices-{launch.ProfileKey}.cursor");

    /** The host's `notices` Reading (SSE) from the saved cursor: each `data:` line is one frame of the log. */
    private async Task ReadNoticesAsync() {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan };
        while (!_stop.IsCancellationRequested && !_retired) {
            try {
                var service = _service;
                using var request = new HttpRequestMessage(HttpMethod.Get, service.Origin + "/pe/resources?" + NoticeInbox.StreamQuery(_inbox.Received));
                request.Headers.Add(TokenHeader, service.Token);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, _stop.Token);
                if (response.IsSuccessStatusCode)
                    await NoticeInbox.ReadFeedAsync(await response.Content.ReadAsStreamAsync(_stop.Token),
                        json => ShowNotices(_inbox.Receive(json)), _stop.Token);
            } catch (OperationCanceledException) { return; }
            catch (Exception error) when (error is HttpRequestException or IOException or InvalidOperationException) { }
            try { await Task.Delay(2_000, _stop.Token); } catch (OperationCanceledException) { return; }
        }
    }

    private void ShowNotices(IReadOnlyList<string> notices) {
        if (notices.Count == 0) return;
        try {
            _window.BeginInvoke(async () => {
                try {
                    var view = await _web.ExecuteScriptAsync("({visible:document.visibilityState==='visible',focused:document.hasFocus(),pathname:location.pathname,thread:new URLSearchParams(location.search).get('thread')})");
                    using var panel = JsonDocument.Parse(view);
                    foreach (var notice in notices) {
                        using var value = JsonDocument.Parse(notice);
                        PostNoticeMessage(new { type = "notice", notice = value.RootElement, view = panel.RootElement });
                    }
                } catch (Exception error) when (error is InvalidOperationException or COMException or JsonException) { }
            });
        } catch (InvalidOperationException) { }
    }

    private void PostNativeMessage<T>(T message) {
        if (_closing || !_ready) return;
        try { _web.CoreWebView2.PostWebMessageAsJson(NativeAdapterContract.SerializeNative(message)); }
        catch (Exception error) when (error is InvalidOperationException or COMException) { }
    }

    private void PostNoticeMessage<T>(T message) {
        if (_closing || _noticeWeb.CoreWebView2 is null) return;
        try { _noticeWeb.CoreWebView2.PostWebMessageAsJson(NativeAdapterContract.SerializeNative(message)); }
        catch (Exception error) when (error is InvalidOperationException or COMException) { }
    }

    /** The card's side of the page protocol: its height, done, and expand to the panel. */
    private bool TryNoticeMessage(JsonElement payload) {
        if (!NativeAdapterContract.Accepts("renderer", payload)) return false;
        var type = payload.GetProperty("type");
        switch (type.GetString()) {
            case "notice-ready":
                ShowNotices(_inbox.PageReady());
                return true;
            case "notice-card":
                var css = (int)payload.GetProperty("height").GetDouble();
                _noticeWindow.PositionCard(css);
                _noticeWindow.Show();
                return true;
            case "notice-hide":
                HideCard();
                return true;
            case "notice-panel":
                HideCard();
                var route = payload.TryGetProperty("url", out var destination) ? destination.GetString() : null;
                if (route is null || TrayLaunch.IsCanonicalRoute(route)) RequestShow(route);
                return true;
            default:
                return false;
        }
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
                        _service = current; _hasPage = false; _rendererReady = false;
                        _noticeHasPage = false; _inbox.PageGone(); HideCard();
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
            var profile = WebViewProfileRoot;
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
                if (!IsOriginalService()) { e.Cancel = true; return; }
                if (!IsViewUrl(e.Uri)) { e.Cancel = true; OpenExternalUrl(e.Uri, e.IsUserInitiated); }
                else if (ShouldRelayNavigation(_rendererReady, e.Uri, _web.Source?.AbsoluteUri)) { e.Cancel = true; RelayNavigation(e.Uri); }
                else { _rendererReady = false; _navigating = true; }
            };
            core.NewWindowRequested += (_, e) => {
                e.Handled = true;
                if (!IsOriginalService() || !e.IsUserInitiated) return;
                if (IsViewUrl(e.Uri)) {
                    if (_rendererReady) RelayNavigation(e.Uri);
                    else OpenWindow(e.Uri);
                }
                else OpenExternalUrl(e.Uri, true);
            };
            core.WebMessageReceived += (_, e) => {
                if (!IsOriginalService() || !IsViewUrl(e.Source)) return;
                try {
                    using var message = JsonDocument.Parse(e.TryGetWebMessageAsString());
                    var payload = message.RootElement;
                    if (!NativeAdapterContract.Accepts("renderer", payload)) return;
                    if (payload.ValueKind == JsonValueKind.Object
                        && payload.TryGetProperty("type", out var readyType) && readyType.ValueKind == JsonValueKind.String
                        && readyType.GetString() == "chrome-ready") {
                        _rendererReady = true;
                        PostTitlebarGeometry(); PostNavigationHistory(); return;
                    }
                    if (TryReadHistoryCommand(payload, _web.CoreWebView2.CanGoBack, _web.CoreWebView2.CanGoForward, out var back)) {
                        if (back) _web.CoreWebView2.GoBack(); else _web.CoreWebView2.GoForward();
                        return;
                    }
                    if (payload.ValueKind == JsonValueKind.Object
                        && payload.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String
                        && type.GetString() == "open-window"
                        && payload.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String
                        && TryGetWindowUrl(url.GetString()!, _service.ViewOrigin, out var destination)) {
                        OpenWindow(destination);
                    }
                    else if (TrayWindow.TryReadChromeTheme(payload, out var background, out var foreground, out var dark)) {
                        _window.ApplyChromeTheme(background, foreground, dark);
                        _recordDev = true;
                    }
                } catch (Exception error) when (error is JsonException or InvalidOperationException or COMException) { }
            };
            core.NavigationCompleted += async (_, e) => {
                _navigating = false;
                if (!e.IsSuccess && e.WebErrorStatus == CoreWebView2WebErrorStatus.OperationCanceled
                    && IsOriginalService() && _hasPage) return;
                _hasPage |= e.IsSuccess;
                _recordDev |= e.IsSuccess;
                if (e.IsSuccess) _pendingPath = null;
                if (!e.IsSuccess) _connected = false;
                if (e.IsSuccess) { PostTitlebarGeometry(); PostNavigationHistory(); }
                await ShowConnectionAsync();
                if (_launch.IsDev && e.IsSuccess) await RecordDevStateAsync();
            };
            core.HistoryChanged += (_, _) => PostNavigationHistory();
            _ready = true;
            await InitializeNoticeWebAsync(environment);
            await CheckHealthAsync();
        } catch (Exception error) when (error is WebView2RuntimeNotFoundException or COMException
                                       or InvalidOperationException or IOException or UnauthorizedAccessException) {
            if (_closing) return;
            _ready = false;
            DevStage("unavailable: " + error.Message);
            _icon.Text = "Pe.Tools: WebView2 unavailable";
        }
    }

    private async Task InitializeNoticeWebAsync(CoreWebView2Environment environment) {
        await _noticeWeb.EnsureCoreWebView2Async(environment);
        if (_closing) return;
        var core = _noticeWeb.CoreWebView2;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        _noticeWindow.ConfigureFrame(_noticeWeb);
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All,
            CoreWebView2WebResourceRequestSourceKinds.All);
        core.WebResourceRequested += (_, e) => {
            var current = IsOriginalService();
            if (!IsHostUrl(e.Request.Uri)) { e.Request.Headers.RemoveHeader(TokenHeader); return; }
            if (current) e.Request.Headers.SetHeader(TokenHeader, _service.Token);
            else e.Response = environment.CreateWebResourceResponse(null, 503, "Parent service retired", "");
        };
        core.NavigationStarting += (_, e) => {
            if (!IsOriginalService() || e.Uri != NoticeUrl) { e.Cancel = true; return; }
            _noticeNavigating = true;
            _inbox.PageGone();
        };
        core.NewWindowRequested += (_, e) => {
            e.Handled = true;
            if (IsOriginalService() && e.IsUserInitiated) OpenExternalUrl(e.Uri, true);
        };
        core.WebMessageReceived += (_, e) => {
            if (!IsOriginalService() || e.Source != NoticeUrl) return;
            try {
                using var message = JsonDocument.Parse(e.TryGetWebMessageAsString());
                var payload = message.RootElement;
                if (!NativeAdapterContract.Accepts("renderer", payload)) return;
                if (TryNoticeMessage(payload)) return;
                if (payload.GetProperty("type").GetString() == "open-window"
                    && TryGetWindowUrl(payload.GetProperty("url").GetString()!, _service.ViewOrigin, out var destination)) {
                    HideCard();
                    OpenWindow(destination);
                }
            } catch (Exception error) when (error is JsonException or InvalidOperationException or COMException) { }
        };
        core.NavigationCompleted += (_, e) => { _noticeNavigating = false; _noticeHasPage = e.IsSuccess; };
    }

    private string NoticeUrl => _service.ViewOrigin + "/open?shell=card";

    private void DevStage(string stage) {
        if (!_launch.IsDev) return;
        try { File.WriteAllText(Path.Combine(_launch.SourceRoot!, ".artifacts", "dev-tray", "boot.json"),
            JsonSerializer.Serialize(new { stage, pid = Environment.ProcessId, when = DateTime.UtcNow })); }
        catch (IOException) { }
    }

    private void PostTitlebarGeometry() {
        if (!_ready || _closing || !IsOriginalService() || _web.Source is not { } source || !IsViewUrl(source.AbsoluteUri)) return;
        PostNativeMessage(_window.ReadTitlebarGeometry());
    }

    private void PostNavigationHistory() {
        if (!_ready || _closing || !IsOriginalService() || _web.Source is not { } source || !IsViewUrl(source.AbsoluteUri)) return;
        PostNativeMessage(new {
            type = "navigation-history", canGoBack = _web.CoreWebView2.CanGoBack, canGoForward = _web.CoreWebView2.CanGoForward
        });
    }

    private void RelayNavigation(string value) {
        // The current renderer owns route policy; an intercepted load must not become a health retry.
        _pendingPath = null; _navigating = false; _hasPage = true;
        if (_closing || !IsOriginalService()
            || !TryGetNavigationRequest(_rendererReady, value, _service.ViewOrigin, out var destination)) return;
        PostNativeMessage(new {
            type = "navigation-request", url = destination
        });
    }

    internal static bool TryGetNavigationRequest(bool rendererReady, string value, string origin, out string destination) {
        destination = "";
        return rendererReady && TryGetWindowUrl(value, origin, out destination);
    }

    internal static bool ShouldRelayNavigation(bool rendererReady, string destination, string? currentUrl) =>
        rendererReady && !destination.Equals(currentUrl, StringComparison.Ordinal);

    internal static bool TryReadHistoryCommand(JsonElement payload, bool canGoBack, bool canGoForward, out bool back) {
        back = false;
        if (!NativeAdapterContract.Accepts("renderer", payload) || payload.GetProperty("type").GetString() != "navigate-history") return false;
        back = payload.GetProperty("direction").GetString() == "back";
        return back ? canGoBack : canGoForward;
    }

    private bool IsHostUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == _service.Origin;
    private bool IsViewUrl(string value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.GetLeftPart(UriPartial.Authority) == _service.ViewOrigin;

    internal static bool TryGetExternalUrl(string value, bool userInitiated, out string destination) {
        destination = "";
        if (!userInitiated || value.Any(char.IsControl) || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || uri.UserInfo.Length != 0) return false;
        destination = uri.AbsoluteUri;
        return true;
    }

    private void OpenExternalUrl(string value, bool userInitiated) {
        if (_web.Source is not { } source || !IsViewUrl(source.AbsoluteUri)
            || !TryGetExternalUrl(value, userInitiated, out var destination)) return;
        try { Process.Start(new ProcessStartInfo(destination) { UseShellExecute = true })?.Dispose(); }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException) {
            _icon.Text = "Pe.Tools: browser link could not open";
        }
    }

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
            if (_ready && _connected && !_noticeHasPage && !_noticeNavigating)
                _noticeWeb.CoreWebView2.Navigate(NoticeUrl);
            _noticeWeb.Enabled = _connected;
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

    private async void OpenWindow(string? destination = null, bool install = false) {
        if (!IsOriginalService()) return;
        var service = _service;
        destination ??= _service.ViewOrigin + "/";
        try {
            if (PwaLauncher.EdgeExecutable is not { } edge) { _icon.Text = "Pe.Tools: Edge unavailable"; return; }
            var installed = await FindPwaAsync();
            if (!IsOriginalService() || service != _service) return;
            _openWindow.Text = "Open window";
            var start = install && installed is null
                ? PwaLauncher.Install(edge, service.ViewOrigin, PwaLauncher.StandardProfileRoot)
                : PwaLauncher.Launch(edge, service.ViewOrigin, destination, installed, PwaLauncher.StandardProfileRoot);
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
            // Quitting cuts every turn in flight: ask first. A list the host will not give is not a reason to hold the quit.
            using var threads = new HttpRequestMessage(HttpMethod.Get, _service.Origin + "/pe/threads");
            threads.Headers.Add(TokenHeader, _service.Token);
            using var listed = await _http.SendAsync(threads, _stop.Token);
            var turns = listed.IsSuccessStatusCode ? TrayQuit.ActiveTurns(await listed.Content.ReadAsStringAsync(_stop.Token)) : 0;
            if (turns > 0 && MessageBox.Show(_window, TrayQuit.Question(turns), "Quit Pe.Tools host",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
            _quitRequested = true;
            using var request = new HttpRequestMessage(HttpMethod.Post, _service.Origin + "/admin/shutdown");
            request.Headers.Add(TokenHeader, _service.Token);
            using var response = await _http.SendAsync(request, _stop.Token);
            if (!response.IsSuccessStatusCode) { _quitRequested = false; _icon.Text = "Pe.Tools: shutdown refused"; }
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
            _noticeWindow.Dispose();
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
        var round = 2; // DWMWA_WINDOW_CORNER_PREFERENCE = DWMWCP_ROUND, rounded panel
        if (OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) DwmSetWindowAttribute(Handle, 33, ref round, sizeof(int));
        SetWindowPos(Handle, IntPtr.Zero, 0, 0, 0, 0, 0x37); // NOMOVE|NOSIZE|NOZORDER|NOACTIVATE|FRAMECHANGED
        ExtendNativeFrame();
        SizeChanged += (_, _) => RefreshTitlebar();
        VisibleChanged += (_, _) => RefreshTitlebar();
        DpiChanged += (_, _) => RefreshTitlebar();
        view.ZoomFactorChanged += (_, _) => RefreshTitlebar();
        RefreshTitlebar();
    }

    internal NativeTitlebarGeometry ReadTitlebarGeometry() {
        if (!_customFrame || !Visible || WindowState == FormWindowState.Minimized
            || DwmGetWindowAttribute(Handle, 5, out NativeRect bounds, Marshal.SizeOf<NativeRect>()) != 0)
            return NativeTitlebarGeometry.Hidden;
        return ProjectTitlebar(new Rectangle(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top),
            ClientSize, DeviceDpi, Visible, _frameView?.ZoomFactor ?? 1);
    }

    internal static NativeTitlebarGeometry ProjectTitlebar(Rectangle buttons, Size client, int dpi, bool visible, double zoomFactor = 1) {
        if (!visible || dpi <= 0 || !double.IsFinite(zoomFactor) || zoomFactor <= 0 || client.Width <= 0 || client.Height <= 0 || buttons.Left <= 0 || buttons.Top < 0
            || buttons.Width <= 0 || buttons.Height <= 0 || buttons.Right > client.Width || buttons.Bottom > client.Height)
            return NativeTitlebarGeometry.Hidden;
        var scale = dpi / 96d * zoomFactor;
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
            // Clip only the child so DWM owns the top-level frame and shadow for the panel.
            ExtendNativeFrame();
            var next = new Region(ContentClipBounds(ClientSize, VisibleFrameBorder));
            if (geometry.visible) {
                var scale = DeviceDpi / 96d * _frameView.ZoomFactor;
                next.Exclude(new Rectangle((int)Math.Round(geometry.rect.width * scale), 0,
                    ClientSize.Width - (int)Math.Round(geometry.rect.width * scale), (int)Math.Ceiling(geometry.rect.height * scale)));
            }
            var old = _frameView.Region; _frameView.Region = next; old?.Dispose();
            TitlebarGeometryChanged?.Invoke(this, EventArgs.Empty);
        } finally { _refreshingFrame = false; }
    }

    private void ExtendNativeFrame() {
        var margins = new NativeMargins { Left = 1, Right = 1, Bottom = 1,
            Top = Math.Max(ResizeBorder, (int)Math.Round(40 * DeviceDpi / 96d)) };
        DwmExtendFrameIntoClientArea(Handle, ref margins);
    }

    public TrayWindow() {
        FormBorderStyle = FormBorderStyle.Sizable;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        AutoScaleMode = AutoScaleMode.None;
        Text = "Pe.Tools";
        DpiChanged += (_, e) => {
            PositionAboveTaskbar(Screen.FromRectangle(e.SuggestedRectangle).WorkingArea, e.DeviceDpiNew);
        };
    }

    /** The panel shows with Activate; a notice card never takes focus from Revit. */
    protected override bool ShowWithoutActivation => true;

    public void PositionAboveTaskbar() {
        if (_positioned && Screen.FromRectangle(Bounds).WorkingArea.Contains(Bounds)) return;
        var work = Screen.FromPoint(Cursor.Position).WorkingArea;
        Location = work.Location;
        PositionAboveTaskbar(work, DeviceDpi);
    }

    public void Rehome() => PositionAboveTaskbar(Screen.FromRectangle(Bounds).WorkingArea, DeviceDpi);

    private void PositionAboveTaskbar(Rectangle work, int dpi) {
        Bounds = HomeBoundsFor(work, dpi);
        _positioned = true;
    }

    internal static Rectangle HomeBoundsFor(Rectangle work, int dpi) {
        var gutter = Math.Max(0, (int)Math.Round(12 * dpi / 96d));
        var insetX = Math.Min(gutter, Math.Max(0, (work.Width - 1) / 2));
        var insetY = Math.Min(gutter, Math.Max(0, (work.Height - 1) / 2));
        var available = new Size(Math.Max(0, work.Width - 2 * insetX), Math.Max(0, work.Height - 2 * insetY));
        var size = SizeFor(available, dpi);
        return new Rectangle(work.Right - insetX - size.Width, work.Bottom - insetY - size.Height, size.Width, size.Height);
    }

    internal static Size SizeFor(Size work, int dpi) =>
        new(Math.Min((int)Math.Round(560 * dpi / 96f), work.Width),
            Math.Min((int)Math.Round(560 * dpi / 96f), work.Height));

    internal static bool TryReadChromeTheme(JsonElement payload, out int background, out int foreground, out bool dark) {
        background = foreground = 0; dark = false;
        if (!NativeAdapterContract.Accepts("renderer", payload) || payload.GetProperty("type").GetString() != "chrome-theme") return false;
        background = (int)payload.GetProperty("background").GetDouble();
        foreground = (int)payload.GetProperty("foreground").GetDouble();
        dark = payload.GetProperty("dark").GetBoolean();
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
            if (message.Msg == 6) ExtendNativeFrame();
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
