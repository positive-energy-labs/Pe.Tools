using System.Runtime.InteropServices;
using System.Text.Json;
using System.Diagnostics;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayLaunchTests {
    [Test]
    public void ReadyRendererReceivesEverySameOriginRouteWithoutNativeRoutePolicy() {
        const string origin = "http://127.0.0.1:5175";
        foreach (var path in new[] { "/open", "/pea?thread=one%2Ftwo", "/settings?section=providers", "/families?target=one#cell", "/future-route" }) {
            Assert.That(TrayContext.TryGetNavigationRequest(false, origin + path, origin, out _), Is.False);
            Assert.That(TrayContext.TryGetNavigationRequest(true, origin + path, origin, out var destination), Is.True);
            Assert.That(destination, Is.EqualTo(origin + path));
        }
        Assert.That(TrayContext.TryGetNavigationRequest(true, origin + "/open?shell=tray&document=one", origin, out var canonical), Is.True);
        Assert.That(canonical, Is.EqualTo(origin + "/open?document=one"));
        foreach (var rejected in new[] { "http://127.0.0.1:5176/open", "https://example.com/open", origin + "/open?token=secret",
            origin + "/open?%74oken=secret", "http://user:password@127.0.0.1:5175/open" })
            Assert.That(TrayContext.TryGetNavigationRequest(true, rejected, origin, out _), Is.False, rejected);
    }

    [Test]
    public void NativeFullReloadAndBootBypassRelayUntilTheNewRendererIsReady() {
        const string current = "http://127.0.0.1:5175/open?shell=tray";
        Assert.That(TrayContext.ShouldRelayNavigation(false, current + "#changed", current), Is.False);
        Assert.That(TrayContext.ShouldRelayNavigation(true, current, current), Is.False);
        Assert.That(TrayContext.ShouldRelayNavigation(true, current + "#changed", current), Is.True);
        Assert.That(TrayContext.ShouldRelayNavigation(true, "http://127.0.0.1:5175/settings", current), Is.True);
    }
    [Test]
    public void RehomeScalesItsScreenGutterAndClampsOnSmallAndOffsetMonitors() {
        var work = new System.Drawing.Rectangle(-1920, -100, 1920, 1080);
        var at96 = TrayWindow.HomeBoundsFor(work, 96);
        Assert.That(at96.Size, Is.EqualTo(new System.Drawing.Size(560, 560)));
        Assert.That(at96.Right, Is.EqualTo(work.Right - 20));
        Assert.That(at96.Bottom, Is.EqualTo(work.Bottom - 20));
        var at192 = TrayWindow.HomeBoundsFor(work, 192);
        Assert.That(at192.Right, Is.EqualTo(work.Right - 40));
        Assert.That(at192.Bottom, Is.EqualTo(work.Bottom - 40));
        Assert.That(work.Contains(at192), Is.True);
        foreach (var small in new[] { new System.Drawing.Rectangle(50, 60, 600, 500), new System.Drawing.Rectangle(-2, -2, 5, 3) })
            Assert.That(small.Contains(TrayWindow.HomeBoundsFor(small, 192)), Is.True);
    }

    [Test]
    public void NativeHistoryCommandsRequireAnAvailableExactDirection() {
        foreach (var direction in new[] { "back", "forward" }) {
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(new { type = "navigate-history", direction }));
            Assert.That(TrayContext.TryReadHistoryCommand(json.RootElement, true, true, out var back), Is.True);
            Assert.That(back, Is.EqualTo(direction == "back"));
            Assert.That(TrayContext.TryReadHistoryCommand(json.RootElement, false, false, out _), Is.False);
            Assert.That(TrayContext.TryReadHistoryCommand(json.RootElement, direction == "back", direction == "forward", out _), Is.True);
        }
        foreach (var invalid in new[] { "null", "[]", "{\"type\":\"navigate-history\",\"direction\":\"Back\"}",
            "{\"type\":\"navigate-history\",\"direction\":true}", "{\"type\":\"navigate-history\"}",
            "{\"type\":\"foreign\",\"direction\":\"back\"}" }) {
            using var json = JsonDocument.Parse(invalid);
            Assert.That(TrayContext.TryReadHistoryCommand(json.RootElement, true, true, out _), Is.False, invalid);
        }
    }
    [Test]
    public void ShowGrammarPreservesOwnerAndAcceptsOnlyCanonicalTokenFreeRoutes() {
        var owner = new[] { "--parent-pid", "123", "--parent-start", "2026-10-09T12:00:00.123Z", "--service-file", Path.GetTempFileName() };
        try {
            var launch = TrayLaunch.Parse([..owner, "--show", "--route", "/pea?thread=one%2Ftwo#turn3"]);
            Assert.That(launch.ShowOnStart, Is.True);
            Assert.That(launch.ParentPid, Is.EqualTo(123));
            Assert.That(launch.Route, Is.EqualTo("/pea?thread=one%2Ftwo#turn3"));
            Assert.That(TrayLaunch.Parse([..owner, "--show"]).Route, Is.Null);
            foreach (var route in new[] { "//foreign/open", "/x\\y", "/open?token=secret", "/open?shell=tray", "/a/../open", "https://foreign/open" })
                Assert.Throws<ArgumentException>(() => TrayLaunch.Parse([..owner, "--show", "--route", route]), route);
            Assert.Throws<ArgumentException>(() => TrayLaunch.Parse([..owner, "--route", "/open"]));
        } finally { File.Delete(owner[5]); }
    }

    [Test]
    public void SingletonTransportsShowRouteToExistingOwnerWithoutCreatingAnotherOwner() {
        var launch = new TrayLaunch(Environment.ProcessId, DateTimeOffset.UtcNow, "fixture");
        var owner = new TraySingleton(launch);
        Assert.That(owner.IsOwner, Is.True);
        // The client must run on another thread because Windows mutexes are reentrant.
        string? shown = null;
        var listening = Task.Run(() => owner.ListenAsync(route => shown = route));
        var result = Task.Run(() => {
            using var client = new TraySingleton(launch);
            Assert.That(client.IsOwner, Is.False);
            return client.ShowAsync("/pea?thread=one#turn3").GetAwaiter().GetResult();
        }).GetAwaiter().GetResult();
        Assert.That(result, Is.True);
        Assert.That(shown, Is.EqualTo("/pea?thread=one#turn3"));
        owner.Dispose();
        listening.GetAwaiter().GetResult();
    }
    [DllImport("shell32.dll")]
    private static extern int GetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] out string appId);

    [Test]
    public void EachTraySurfaceHasOneDistinctAppUserModelIdTheProcessSetsOnce() {
        var installed = new TrayLaunch(1, DateTimeOffset.UnixEpoch, "service.json");
        var devA = new TrayLaunch(1, DateTimeOffset.UnixEpoch, "service.json") { SupervisorFile = "a.json", SourceRoot = @"C:\work\Pe.Tools" };
        var devB = devA with { SourceRoot = @"C:\work\Pe.Tools-other" };
        var ids = new[] { installed, devA, devB }.Select(TrayIdentity.AppUserModelId).ToArray();
        Assert.That(ids.Distinct().Count(), Is.EqualTo(3));
        Assert.That(TrayIdentity.AppUserModelId(devA), Is.EqualTo(TrayIdentity.AppUserModelId(devA with { SourceRoot = @"C:\WORK\pe.tools" })));
        Assert.That(ids, Has.All.Matches<string>(id => id.Length <= 128 && id.StartsWith("PositiveEnergy.PeTools.Tray") && !id.Contains(' ')));
        TrayIdentity.Apply(devA);
        Assert.That(GetCurrentProcessExplicitAppUserModelID(out var set), Is.Zero);
        Assert.That(set, Is.EqualTo(TrayIdentity.AppUserModelId(devA)));
    }

    [Test]
    public void DevSupervisorRebindsOnlyVerifiedCheckoutIncarnations() {
        var directory = Path.Combine(Path.GetTempPath(), "PeTools.DevTray." + Guid.NewGuid());
        var state = Path.Combine(directory, ".artifacts", "dev-tray");
        Directory.CreateDirectory(state);
        File.WriteAllText(Path.Combine(directory, "Pe.Tools.slnx"), "fixture");
        using var process = Process.GetCurrentProcess();
        var start = process.StartTime.ToUniversalTime().ToString("o");
        var supervisor = Path.Combine(state, "supervisor.json");
        var service = Path.Combine(state, "service.json");
        var session = Path.Combine(state, "session.json");
        void Write(string path, object value) => File.WriteAllText(path, JsonSerializer.Serialize(value));
        Write(supervisor, new { schemaVersion = 1, sourceRoot = directory, pid = process.Id,
            processStartUtc = start, instanceId = "supervisor" });
        var host = new Dictionary<string, object> { ["schemaVersion"] = 3, ["sourceRoot"] = directory,
            ["lane"] = "dev", ["pid"] = process.Id, ["processStartUtc"] = start,
            ["instanceId"] = "first", ["port"] = 58282, ["version"] = "dev", ["token"] = "secret", ["health"] = "/host/status" };
        var pair = new Dictionary<string, object> { ["schemaVersion"] = 1, ["sourceRoot"] = directory,
            ["serviceFile"] = service, ["hostInstanceId"] = "first", ["frontendPid"] = process.Id,
            ["frontendStartUtc"] = start, ["frontendOrigin"] = "http://127.0.0.1:5175" };
        try {
            Write(service, host); Write(session, pair);
            var launch = TrayLaunch.Parse(["--dev", "--supervisor-file", supervisor]);
            Assert.That(launch.ReadService().ViewOrigin, Is.EqualTo("http://127.0.0.1:5175"));
            host["instanceId"] = "second"; Write(service, host);
            Assert.Throws<InvalidDataException>(() => launch.ReadService());
            pair["hostInstanceId"] = "second"; Write(session, pair);
            Assert.That(launch.ReadService().InstanceId, Is.EqualTo("second"));
            foreach (var (key, invalid) in new (string, object)[] {
                ("lane", "installed"), ("sourceRoot", directory + "-foreign"), ("pid", int.MaxValue) }) {
                var valid = host[key]; host[key] = invalid; Write(service, host);
                Assert.Throws<InvalidDataException>(() => launch.ReadService(), key);
                host[key] = valid;
            }
            Write(service, host);
            pair["frontendPid"] = int.MaxValue; Write(session, pair);
            Assert.Throws<InvalidDataException>(() => launch.ReadService());
            Write(Path.Combine(state, "show.json"), new { instanceId = "foreign", nonce = "show" });
            Assert.That(launch.ReadShowRequest(), Is.Null);
            Write(Path.Combine(state, "show.json"), new { instanceId = "supervisor", nonce = "show" });
            Assert.That(launch.ReadShowRequest(), Is.EqualTo("show"));
        } finally { Directory.Delete(directory, true); }
    }

    [Test]
    public void WindowHandoffPreservesResourceAddressWithoutTrayShell() {
        const string origin = "http://127.0.0.1:58282";
        Assert.That(TrayContext.TryGetWindowUrl(
            origin + "/pea?thread=thread%2Fone&shell=tray&target=%7B%22openId%22%3A%22doc%22%7D#turn-3",
            origin, out var destination), Is.True);
        Assert.That(destination, Is.EqualTo(
            origin + "/pea?thread=thread%2Fone&target=%7B%22openId%22%3A%22doc%22%7D#turn-3"));
    }

    [TestCase("https://elsewhere.test/pea")]
    [TestCase("http://127.0.0.1:58283/pea")]
    [TestCase("http://name:password@127.0.0.1:58282/pea")]
    [TestCase("http://127.0.0.1:58282/pea?%74oken=secret")]
    [TestCase("http://127.0.0.1:58282/pea?x-pe-service-token=secret")]
    [TestCase("http://127.0.0.1:58282/pea?serviceToken=secret")]
    [TestCase("/pea?thread=one")]
    public void WindowHandoffRefusesForeignOriginsCredentialsAndTokens(string value) {
        Assert.That(TrayContext.TryGetWindowUrl(value, "http://127.0.0.1:58282", out _), Is.False);
    }

    [Test]
    public void TraySizeScalesWithMonitorDpiAndClampsToWorkArea() {
        Assert.That(TrayWindow.SizeFor(new System.Drawing.Size(3840, 2200), 192),
            Is.EqualTo(new System.Drawing.Size(1120, 1120)));
        Assert.That(TrayWindow.SizeFor(new System.Drawing.Size(600, 500), 192),
            Is.EqualTo(new System.Drawing.Size(600, 500)));
    }

    [Test]
    public void ExternalBrowserLinksRequireAUserClickAndWebAddress() {
        const string pdf = "https://www.magicaire.com/wp-content/uploads/2014/01/HBB-Submittal-12142013.pdf";
        Assert.That(TrayContext.TryGetExternalUrl(pdf, true, out var destination), Is.True);
        Assert.That(destination, Is.EqualTo(pdf));
        Assert.That(TrayContext.TryGetExternalUrl(pdf, false, out _), Is.False);
        foreach (var refused in new[] { "file:///C:/secret.txt", "javascript:alert(1)", "data:text/html,test",
                     "https://user:password@example.com/", "https://example.com/\n", "/relative" })
            Assert.That(TrayContext.TryGetExternalUrl(refused, true, out _), Is.False, refused);
    }

    [Test]
    public void LaunchPinsParentAndServiceIncarnationWithoutAssumingPort5180() {
        var path = Path.GetTempFileName();
        try {
            const string start = "2026-10-09T12:00:00.123Z";
            var launch = TrayLaunch.Parse(["--parent-pid", "123", "--parent-start", start, "--service-file", path]);
            var fields = new Dictionary<string, object> {
                ["schemaVersion"] = 3, ["instanceId"] = "original", ["pid"] = 123,
                ["processStartUtc"] = start, ["port"] = 58282, ["version"] = "0.7.0",
                ["lane"] = "installed", ["token"] = "secret", ["health"] = "/host/status"
            };
            void Write() => File.WriteAllText(path, JsonSerializer.Serialize(fields));
            Write();
            var original = launch.ReadService();
            Assert.That(original.Origin, Is.EqualTo("http://127.0.0.1:58282"));
            Assert.That(launch.MatchesParent(123, launch.ParentStart.AddMilliseconds(2_000)), Is.True);
            Assert.That(launch.MatchesParent(123, launch.ParentStart.AddMilliseconds(2_001)), Is.False);
            Assert.That(launch.MatchesParent(124, launch.ParentStart), Is.False);
            foreach (var (key, invalid) in new (string, object)[] {
                         ("schemaVersion", 4), ("pid", 124), ("processStartUtc", "2026-10-09T12:00:01.123Z"),
                         ("port", 0), ("port", 65536), ("lane", "dev"), ("token", "secret\r\nInjected: true"),
                         ("health", "//elsewhere/"), ("health", "/\\elsewhere/") }) {
                var valid = fields[key];
                fields[key] = invalid;
                Write();
                Assert.Throws<InvalidDataException>(() => launch.ReadService(), key);
                fields[key] = valid;
            }
            fields["instanceId"] = "successor";
            Write();
            Assert.That(launch.ReadService(), Is.Not.EqualTo(original));
            Assert.Throws<ArgumentException>(() => TrayLaunch.Parse(["--token", "secret"]));
        } finally { File.Delete(path); }
    }
}
