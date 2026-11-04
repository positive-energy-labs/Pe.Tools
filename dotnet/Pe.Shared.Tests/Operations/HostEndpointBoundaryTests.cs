using Pe.Shared.HostContracts.Transport;
using Pe.Shared.Product;

namespace Pe.Revit.Tests;

[TestFixture]
[NonParallelizable]
public sealed class HostEndpointBoundaryTests {
    [TearDown]
    public void ClearStartup() => HostEndpoint.DevHostStartup = null;

    [Test]
    public async Task Local_startup_waits_for_readiness_then_continues_receipt_validation() {
        var runtime = ProductRuntimeLayout.For(ProductLane.Dev, Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")), null);
        var startup = new HostStartupReadiness(runtime, Pe.App.Host.TsHostLauncher.DevStartupTimeout);
        HostEndpoint.DevHostStartup = startup;
        var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var caller = Task.Run(() => {
            entered.SetResult(true);
            Assert.That(() => HostEndpoint.ResolveHostBaseUrl(runtime, null, null),
                Throws.InvalidOperationException.With.Message.Contains("No running"));
        });
        await entered.Task;
        Assert.That(caller.IsCompleted, Is.False);
        startup.Succeed();
        await caller;
    }

    [Test]
    public async Task Local_startup_failure_reaches_waiter_as_typed_failure() {
        var runtime = ProductRuntimeLayout.For(ProductLane.Dev, Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")), null);
        var startup = new HostStartupReadiness(runtime, Pe.App.Host.TsHostLauncher.DevStartupTimeout);
        HostEndpoint.DevHostStartup = startup;
        var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var caller = Task.Run(() => {
            entered.SetResult(true);
            Assert.That(() => HostEndpoint.ResolveHostBaseUrl(runtime, null, null),
                Throws.TypeOf<HostStartupException>().With.Message.EqualTo("launch refused"));
        });
        await entered.Task;
        startup.Fail("launch refused");
        await caller;
    }

    [Test]
    public void Installed_resolution_does_not_wait_for_dev_supervisor() {
        var runtime = ProductRuntimeLayout.For(ProductLane.Installed, @"C:\copied-install", null);
        HostEndpoint.DevHostStartup = new HostStartupReadiness(runtime, Pe.App.Host.TsHostLauncher.DevStartupTimeout);
        Assert.That(() => HostEndpoint.ResolveHostBaseUrl(runtime, null, null),
            Throws.InvalidOperationException.With.Message.Contains("canonical installation owner"));
    }

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
