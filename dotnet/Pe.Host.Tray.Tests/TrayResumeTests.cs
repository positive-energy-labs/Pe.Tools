using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

public class TrayResumeTests {
    private string _path = "";
    private static readonly DateTimeOffset Now = new(2026, 10, 13, 12, 0, 0, TimeSpan.Zero);

    [SetUp]
    public void SetUp() => _path = Path.Combine(Path.GetTempPath(), $"tray-resume-{Guid.NewGuid():N}.json");

    [TearDown]
    public void TearDown() => File.Delete(_path);

    [Test]
    public void TheRouteTheWindowShowedComesBackOnceAndTheFileIsConsumed() {
        TrayResume.Save(_path, "/pea?thread=abc123", Now);
        Assert.That(TrayResume.Take(_path, Now.AddSeconds(90)), Is.EqualTo("/pea?thread=abc123"));
        Assert.That(File.Exists(_path), Is.False);
        Assert.That(TrayResume.Take(_path, Now.AddSeconds(91)), Is.Null);
    }

    [Test]
    public void AMemoryOlderThanAnUpdateTakesIsStaleAndStillConsumed() {
        TrayResume.Save(_path, "/machine", Now);
        Assert.That(TrayResume.Take(_path, Now.AddMinutes(6)), Is.Null);
        Assert.That(File.Exists(_path), Is.False);
    }

    [Test]
    public void ARouteThatIsNotACanonicalWindowPathIsNeverShown() {
        File.WriteAllText(_path, """{"route":"//evil.example/x","savedAtUtc":"2026-10-13T12:00:00Z"}""");
        Assert.That(TrayResume.Take(_path, Now), Is.Null);
        File.WriteAllText(_path, "not json");
        Assert.That(TrayResume.Take(_path, Now), Is.Null);
        Assert.That(TrayResume.Take(Path.Combine(Path.GetTempPath(), "absent-" + Guid.NewGuid().ToString("N")), Now), Is.Null);
    }

    [TestCase("http://127.0.0.1:5180/pea?thread=abc&shell=tray", "/pea?thread=abc")]
    [TestCase("http://127.0.0.1:5180/?shell=tray", "/")]
    [TestCase("http://127.0.0.1:5180/machine?shell=tray&section=update#top", "/machine?section=update#top")]
    [TestCase("http://127.0.0.1:5180/settings", "/settings")]
    public void TheShellMarkerTheTrayAddsIsNotPartOfWhereTheUserWas(string source, string route) =>
        Assert.That(TrayResume.RouteOf(new Uri(source)), Is.EqualTo(route));
}
