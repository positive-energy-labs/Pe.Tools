using Pe.Global.Services.SignalR;
using Pe.Global.Services.Storage.Core;
using Xunit;

namespace Toon.Tests;

public class SettingsEditorHardeningTests {
    [Fact]
    public void EnvelopeCode_includes_NoDocument_for_machine_readable_precondition_failures() {
        var names = Enum.GetNames(typeof(EnvelopeCode));
        Assert.Contains(nameof(EnvelopeCode.NoDocument), names);
    }

    [Fact]
    public void Hub_requests_do_not_expose_subdirectory() {
        Assert.DoesNotContain(
            typeof(ListSettingsRequest).GetProperties(),
            property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase)
        );
        Assert.DoesNotContain(
            typeof(ReadSettingsRequest).GetProperties(),
            property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase)
        );
        Assert.DoesNotContain(
            typeof(WriteSettingsRequest).GetProperties(),
            property => string.Equals(property.Name, "SubDirectory", StringComparison.OrdinalIgnoreCase)
        );
    }

    [Fact]
    public void ResolveSafeSubDirectoryPath_rejects_traversal_segments() {
        var root = Path.Combine(Path.GetTempPath(), "pe-tools-settings-hardening");
        _ = Directory.CreateDirectory(root);

        _ = Assert.Throws<ArgumentException>(() =>
            SettingsPathing.ResolveSafeSubDirectoryPath(root, "../sibling", "subdirectory")
        );
    }

    [Fact]
    public async Task EndpointThrottleGate_coalesces_inflight_and_caches() {
        var gate = new EndpointThrottleGate();
        var key = "conn:examples:FFMigrator:FamilyName";
        var invoked = 0;
        var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        async Task<string> Factory() {
            _ = Interlocked.Increment(ref invoked);
            _ = await release.Task;
            return "ok";
        }

        var firstTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        var secondTask = gate.ExecuteAsync(key, TimeSpan.FromMilliseconds(250), Factory);
        release.SetResult(true);

        var first = await firstTask;
        var second = await secondTask;

        Assert.Equal(1, Volatile.Read(ref invoked));
        Assert.Equal("ok", first.Result);
        Assert.Equal("ok", second.Result);
        Assert.Contains(first.Decision, new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced });
        Assert.Contains(second.Decision, new[] { ThrottleDecision.Executed, ThrottleDecision.Coalesced });

        var cached = await gate.ExecuteAsync(
            key,
            TimeSpan.FromMilliseconds(250),
            () => Task.FromResult("should-not-run")
        );
        Assert.Equal(ThrottleDecision.CacheHit, cached.Decision);
        Assert.Equal("ok", cached.Result);
    }
}
