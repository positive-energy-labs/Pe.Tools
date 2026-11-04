using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

[TestFixture]
public sealed class HostEndpointBoundaryTests {
    [Test]
    public void Missing_checkout_receipt_never_uses_default_or_explicit_host() {
        var runtime = ProductRuntimeLayout.For(ProductLane.Dev, Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")), null);
        foreach (var target in new string?[] { null, "http://127.0.0.1:5180" })
            Assert.That(() => HostEndpoint.ResolveHostBaseUrl(runtime, null, target),
                Throws.InvalidOperationException.With.Message.Contains("No running"));
    }

    [Test]
    public void Installed_payload_requires_its_manifest_executable_before_discovery() {
        var runtime = ProductRuntimeLayout.For(ProductLane.Installed, @"C:\copied-install", null);
        Assert.That(() => HostEndpoint.ResolveHostBaseUrl(runtime, null, null),
            Throws.InvalidOperationException.With.Message.Contains("canonical installation owner"));
    }
}
