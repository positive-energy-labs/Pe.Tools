using System.Text.Json;
using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayLaunchTests {
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
