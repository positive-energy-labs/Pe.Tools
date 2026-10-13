using System.Text.Json;
using System.Diagnostics;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayLaunchTests {
    [Test]
    public void ChromeThemeAcceptsOnlyExplicitColorrefsAndBooleanMode() {
        using var valid = JsonDocument.Parse("{\"type\":\"chrome-theme\",\"background\":197121,\"foreground\":16777215,\"dark\":true}");
        Assert.That(TrayWindow.TryReadChromeTheme(valid.RootElement, out var background, out var foreground, out var dark), Is.True);
        Assert.That(background, Is.EqualTo(0x030201));
        Assert.That(foreground, Is.EqualTo(0xFFFFFF));
        Assert.That(dark, Is.True);
        foreach (var invalid in new[] {
            "null", "[]", "{\"type\":\"other\",\"background\":0,\"foreground\":0,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":-1,\"foreground\":0,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":16777216,\"foreground\":0,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":0.5,\"foreground\":0,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":\"0\",\"foreground\":0,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":0,\"foreground\":-1,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":0,\"foreground\":16777216,\"dark\":true}",
            "{\"type\":\"chrome-theme\",\"background\":0,\"foreground\":0,\"dark\":1}",
            "{\"type\":\"chrome-theme\",\"background\":0,\"foreground\":0}" }) {
            using var json = JsonDocument.Parse(invalid);
            Assert.That(TrayWindow.TryReadChromeTheme(json.RootElement, out _, out _, out _), Is.False, invalid);
        }
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
            Is.EqualTo(new System.Drawing.Size(1520, 1120)));
        Assert.That(TrayWindow.SizeFor(new System.Drawing.Size(600, 500), 192),
            Is.EqualTo(new System.Drawing.Size(600, 500)));
    }

    [Test]
    public void NativeTitlebarUsesMeasuredBoundsAndFailsClosedForUnavailableGeometry() {
        var client = new System.Drawing.Size(1100, 700);
        var buttons = new System.Drawing.Rectangle(796, 0, 292, 57);
        var geometry = TrayWindow.ProjectTitlebar(buttons, client, 192, true);
        Assert.That(geometry.visible, Is.True);
        Assert.That(geometry.rect, Is.EqualTo(new NativeTitlebarRect(0, 0, 398, 28.5)));
        Assert.That(TrayWindow.ProjectTitlebar(buttons, client, 192, false), Is.EqualTo(NativeTitlebarGeometry.Hidden));
        Assert.That(TrayWindow.ProjectTitlebar(buttons, client, 0, true), Is.EqualTo(NativeTitlebarGeometry.Hidden));
        foreach (var invalid in new[] { System.Drawing.Rectangle.Empty, new System.Drawing.Rectangle(-1, 0, 292, 57),
                     new System.Drawing.Rectangle(796, -1, 292, 57), new System.Drawing.Rectangle(796, 0, 400, 57),
                     new System.Drawing.Rectangle(796, 0, 292, 701) })
            Assert.That(TrayWindow.ProjectTitlebar(invalid, client, 192, true), Is.EqualTo(NativeTitlebarGeometry.Hidden));
    }

    [Test]
    public void NativeFrameClipPreservesAppBarControlsInsideTheVisibleBorder() {
        var clip = TrayWindow.ContentClipBounds(new System.Drawing.Size(1100, 700), 2);
        // AppBar controls begin at 4 CSS pixels left and 2.25 CSS pixels top; this vector is at DPR2.
        Assert.That(clip.Contains(8, 4), Is.True);
        Assert.That(clip.Contains(1, 4), Is.False);
        Assert.That(clip, Is.EqualTo(new System.Drawing.Rectangle(2, 2, 1096, 696)));
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
