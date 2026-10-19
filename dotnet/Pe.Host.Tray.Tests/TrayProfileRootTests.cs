using NUnit.Framework;
using Pe.Host.Tray;

namespace Pe.Host.Tray.Tests;

[NonParallelizable]
public class TrayProfileRootTests {
    [Test]
    public void WebViewAndEdgeAppProfilesFollowTheProductHomeOverride() {
        var previous = Environment.GetEnvironmentVariable("PE_TOOLS_PRODUCT_HOME");
        var home = Path.Combine(Path.GetTempPath(), "pe-tray-home-" + Guid.NewGuid().ToString("N"));
        try {
            Environment.SetEnvironmentVariable("PE_TOOLS_PRODUCT_HOME", null);
            var owner = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Positive Energy", "Pe.Tools");
            Assert.That(TrayContext.WebViewProfileRoot, Is.EqualTo(Path.Combine(owner, "tray-webview")));
            Assert.That(PwaLauncher.PrivateProfileRoot, Is.EqualTo(Path.Combine(owner, "edge-app")));
            Environment.SetEnvironmentVariable("PE_TOOLS_PRODUCT_HOME", home);
            Assert.That(TrayContext.WebViewProfileRoot, Is.EqualTo(Path.Combine(home, ".local-state", "tray-webview")));
            Assert.That(PwaLauncher.PrivateProfileRoot, Is.EqualTo(Path.Combine(home, ".local-state", "edge-app")));
        } finally {
            Environment.SetEnvironmentVariable("PE_TOOLS_PRODUCT_HOME", previous);
        }
    }
}
