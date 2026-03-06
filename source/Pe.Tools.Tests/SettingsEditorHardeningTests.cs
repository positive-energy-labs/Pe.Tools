using Pe.Global.Services.SignalR;
using Pe.Global.Services.Storage.Core;

namespace Pe.Tools.Tests;

public sealed class SettingsEditorHardeningTests : RevitTestBase
{
    [Test]
    public async Task EnvelopeCode_includes_NoDocument_for_machine_readable_precondition_failures()
    {
        var names = Enum.GetNames(typeof(EnvelopeCode));

        await Assert.That(names).Contains(nameof(EnvelopeCode.NoDocument));
    }

    [Test]
    public async Task Hub_requests_do_not_expose_subdirectory()
    {
        await Assert.That(typeof(SettingsCatalogRequest).GetProperties())
            .DoesNotContain(property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase));
        await Assert.That(typeof(ValidateSettingsRequest).GetProperties())
            .DoesNotContain(property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase));
    }

    [Test]
    public async Task ResolveSafeSubDirectoryPath_rejects_traversal_segments()
    {
        var root = Path.Combine(Path.GetTempPath(), "pe-tools-settings-hardening");
        _ = Directory.CreateDirectory(root);

        _ = await Assert.That(() => SettingsPathing.ResolveSafeSubDirectoryPath(root, "../sibling", "subdirectory"))
            .Throws<ArgumentException>();
    }

    [Test]
    public async Task EndpointThrottleGate_coalesces_inflight_and_caches()
    {
        var gate = new EndpointThrottleGate();
        var key = "conn:examples:FFMigrator:FamilyName";
        var invoked = 0;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<string> Factory()
        {
            _ = Interlocked.Increment(ref invoked);
            _ = await release.Task;
            return "ok";
        }

        var firstTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        var secondTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        release.SetResult(true);

        var first = await firstTask;
        var second = await secondTask;

        await Assert.That(Volatile.Read(ref invoked)).IsEqualTo(1);
        await Assert.That(first.Result).IsEqualTo("ok");
        await Assert.That(second.Result).IsEqualTo("ok");
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(first.Decision);
        await Assert.That(new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced }).Contains(second.Decision);

        var cached = await gate.ExecuteAsync(
            key,
            TimeSpan.FromMilliseconds(250),
            () => Task.FromResult("should-not-run")
        );

        await Assert.That(cached.Decision).IsEqualTo(ThrottleDecision.CacheHit);
        await Assert.That(cached.Result).IsEqualTo("ok");
    }
}
