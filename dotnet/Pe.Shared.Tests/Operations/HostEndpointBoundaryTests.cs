using Pe.Shared.HostContracts.Transport;

namespace Pe.Revit.Tests;

[TestFixture, NonParallelizable]
public sealed class HostEndpointBoundaryTests {
    [Test]
    public void Unknown_payload_owner_cannot_use_an_explicit_url() {
        var previousLane = HostEndpoint.ConfiguredLane;
        try {
            HostEndpoint.ConfiguredLane = null;
            Assert.That(() => HostEndpoint.ResolveHostBaseUrl("http://127.0.0.1:5180"),
                Throws.InvalidOperationException.With.Message.Contains("no configured runtime owner"));
        } finally {
            HostEndpoint.ConfiguredLane = previousLane;
        }
    }

    [Test]
    public void Missing_checkout_receipt_never_uses_default_or_explicit_host() {
        var previousLane = HostEndpoint.ConfiguredLane;
        var previousRoot = HostEndpoint.ConfiguredSourceRoot;
        var previousName = HostEndpoint.ConfiguredServiceName;
        try {
            HostEndpoint.ConfiguredLane = "dev";
            HostEndpoint.ConfiguredSourceRoot = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
            HostEndpoint.ConfiguredServiceName = HostEndpoint.SourceServiceName(HostEndpoint.ConfiguredSourceRoot);
            foreach (var target in new string?[] { null, "http://127.0.0.1:5180" })
                Assert.That(() => HostEndpoint.ResolveHostBaseUrl(target),
                    Throws.InvalidOperationException.With.Message.Contains("No running"));
        } finally {
            HostEndpoint.ConfiguredLane = previousLane;
            HostEndpoint.ConfiguredSourceRoot = previousRoot;
            HostEndpoint.ConfiguredServiceName = previousName;
        }
    }

    [TestCase("unknown"), TestCase("")]
    public void Unknown_lane_has_no_service_identity(string lane) =>
        Assert.That(() => HostEndpoint.ResolveServiceName(lane, "C:/checkout"), Throws.ArgumentException);

    [TestCase(null), TestCase("C:/copied-install")]
    public void Installed_payload_requires_canonical_installation_before_discovery(string? installedRoot) {
        var previousLane = HostEndpoint.ConfiguredLane;
        var previousRoot = HostEndpoint.ConfiguredSourceRoot;
        var previousName = HostEndpoint.ConfiguredServiceName;
        var previousInstall = HostEndpoint.ConfiguredInstalledRoot;
        var previousExecutable = HostEndpoint.ConfiguredExecutablePath;
        try {
            HostEndpoint.ConfiguredLane = "installed";
            HostEndpoint.ConfiguredSourceRoot = null;
            HostEndpoint.ConfiguredServiceName = "host";
            HostEndpoint.ConfiguredInstalledRoot = installedRoot;
            HostEndpoint.ConfiguredExecutablePath = "C:/copied-install/Pe.Host.exe";
            Assert.That(() => HostEndpoint.ResolveHostBaseUrl(),
                Throws.InvalidOperationException.With.Message.Contains("canonical installation owner"));
        } finally {
            HostEndpoint.ConfiguredLane = previousLane;
            HostEndpoint.ConfiguredSourceRoot = previousRoot;
            HostEndpoint.ConfiguredServiceName = previousName;
            HostEndpoint.ConfiguredInstalledRoot = previousInstall;
            HostEndpoint.ConfiguredExecutablePath = previousExecutable;
        }
    }
}
