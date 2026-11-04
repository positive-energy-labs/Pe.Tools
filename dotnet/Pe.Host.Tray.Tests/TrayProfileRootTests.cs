using System.Text.Json;
using NUnit.Framework;
using Pe.Host.Tray;
using Pe.Shared.Product;

// The tray process configures its runtime once from argv; this assembly does the same, once, so
// TrayContext/PwaLauncher paths resolve under a temp owner and never the machine's installed root.
[SetUpFixture]
public sealed class TrayTestRuntime {
    [OneTimeSetUp]
    public void Configure() =>
        ProductRuntimeLayout.Configure(ProductLane.Dev, Path.Combine(Path.GetTempPath(), "pe-tray-tests-" + Guid.NewGuid().ToString("N")));
}

namespace Pe.Host.Tray.Tests {
    public class TrayProfileRootTests {
        [Test]
        public void WebViewAndEdgeAppProfilesLiveUnderTheConfiguredRuntime() {
            var root = ProductRuntimeLayout.Current.RootPath;
            Assert.That(TrayContext.WebViewProfileRoot, Is.EqualTo(Path.Combine(root, "tray-webview")));
            Assert.That(PwaLauncher.PrivateProfileRoot, Is.EqualTo(Path.Combine(root, "edge-app")));
        }

        // Cross-seam: the TS host's trayOwnerArguments emits exactly these rows (host-contracts
        // runtime-ownership.test.ts asserts the same file), and the tray must accept every one.
        [Test]
        public void TrayAcceptsEveryOwnerArgvTheHostEmits() {
            using var fixture = JsonDocument.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "runtime-ownership.fixture.json")));
            foreach (var row in fixture.RootElement.GetProperty("trayLaunches").EnumerateArray()) {
                var name = row.GetProperty("name").GetString();
                var owner = row.GetProperty("owner");
                var argv = row.GetProperty("argv").EnumerateArray().Select(value => value.GetString()!).ToArray();
                var launch = row.GetProperty("launch").EnumerateArray().Select(value => value.GetString()!).ToArray();
                var (lane, root, rest) = ProductRuntimeLayout.ParseOwnerArguments(argv);
                var dev = owner.GetProperty("lane").GetString() == "dev";
                Assert.That(lane, Is.EqualTo(dev ? ProductLane.Dev : ProductLane.Installed), name);
                Assert.That(root, Is.EqualTo(owner.GetProperty(dev ? "sourceRoot" : "installedRoot").GetString()), name);
                Assert.That(rest, Is.EqualTo(launch), name);
                // The remaining argv must be a form the tray dispatches (window launch, or an owner it parses).
                if (rest[0] == "--parent-pid") Assert.That(TrayLaunch.Parse(rest).ParentPid, Is.EqualTo(4242), name);
                else if (rest[0] != "--dev") Assert.That(rest.Length == 2 && rest[0] == "--launch-window", Is.True, name);
            }
        }

        [TestCase("")]
        [TestCase("--launch-window http://127.0.0.1:5150/open")]
        [TestCase(@"--lane beta --root C:\src\Pe.Tools --launch-window x")]
        [TestCase(@"--lane dev --root src\Pe.Tools --launch-window x")]
        public void TrayRefusesALaunchThatDoesNotNameItsOwner(string argv) =>
            Assert.That(() => ProductRuntimeLayout.ParseOwnerArguments(argv.Split(' ', StringSplitOptions.RemoveEmptyEntries)), Throws.ArgumentException);
    }
}
