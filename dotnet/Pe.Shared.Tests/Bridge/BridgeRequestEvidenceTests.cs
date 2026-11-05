using NUnit.Framework;
using Pe.Shared.HostContracts.Bridge;
using System.Diagnostics;

namespace Pe.Bridge.Tests;

public class BridgeRequestEvidenceTests {
    [TestCase("AbandonedStillRunning", "Succeeded")]
    [TestCase("AbandonedStillRunning", "Failed")]
    [TestCase("AbandonedStillRunning", "Cancelled")]
    [TestCase("TimedOut", "Cancelled")]
    public async Task CompletionIsCreatedOnceAndRetainedAcrossBrokenConnections(string state, string outcome) {
        var evidence = new BridgeRequestEvidence();
        evidence.Begin("host-request");
        evidence.Uncertain("host-request", state);
        using var process = Process.GetCurrentProcess();
        var snapshot = evidence.Snapshot();
        Assert.That(snapshot.ProcessId, Is.EqualTo(process.Id));
        Assert.That(snapshot.ProcessStartUtcUnixMs, Is.EqualTo(new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()));
        Assert.That(snapshot.Requests.Single().State, Is.EqualTo(state));
        await evidence.AttachAsync(_ => Task.FromException(new IOException("closed")));
        await evidence.CompleteAsync("host-request", outcome, "receipt");
        var terminal = evidence.Snapshot().Terminals.Single();
        Assert.That(terminal.RequestId, Is.EqualTo("host-request"));
        Assert.That(terminal.Outcome, Is.EqualTo(outcome));
        Assert.That(terminal.ReceiptId, Is.EqualTo("receipt"));
        Assert.That(terminal.CompletedAtUnixMs, Is.GreaterThanOrEqualTo(terminal.StartedAtUnixMs));
        Assert.That(evidence.Snapshot().Requests, Is.Empty);
        await evidence.CompleteAsync("host-request", "Failed", null);
        Assert.That(evidence.Snapshot().Terminals.Single(), Is.EqualTo(terminal));
        var sent = new List<BridgeFrame>();
        await evidence.AttachAsync(frame => { sent.Add(frame); return Task.CompletedTask; });
        Assert.That(sent.Single().Kind, Is.EqualTo(BridgeFrameKind.Terminal));
        Assert.That(sent.Single().Terminal, Is.EqualTo(terminal));
        Assert.That(evidence.Snapshot().Terminals, Is.Empty);
    }

    [TestCase("Succeeded")]
    [TestCase("Failed")]
    [TestCase("Cancelled")]
    public async Task TerminalWaitsForActualCompletionEvenAfterCallerHasLeft(string outcome) {
        var evidence = new BridgeRequestEvidence();
        var completion = new TaskCompletionSource<object?>(TaskCreationOptions.RunContinuationsAsynchronously);
        evidence.Begin("abandoned");
        evidence.Uncertain("abandoned", "AbandonedStillRunning");
        var observe = evidence.CompleteWhenFinishedAsync("abandoned", completion.Task, null);
        Assert.That(observe.IsCompleted, Is.False);
        Assert.That(evidence.Snapshot().Requests.Single().RequestId, Is.EqualTo("abandoned"));
        Assert.That(evidence.Snapshot().Terminals, Is.Empty);
        if (outcome == "Succeeded") completion.SetResult(null);
        else if (outcome == "Failed") completion.SetException(new InvalidOperationException("native failure"));
        else completion.SetCanceled();
        await observe;
        Assert.That(evidence.Snapshot().Requests, Is.Empty);
        Assert.That(evidence.Snapshot().Terminals.Single().Outcome, Is.EqualTo(outcome));
    }

    [Test]
    public async Task OldConnectionDisposalCannotDetachItsReplacement() {
        var evidence = new BridgeRequestEvidence();
        Func<BridgeFrame, Task> old = _ => Task.CompletedTask;
        var sent = new List<BridgeFrame>();
        await evidence.AttachAsync(old);
        await evidence.AttachAsync(frame => { sent.Add(frame); return Task.CompletedTask; });
        evidence.Detach(old);
        evidence.Begin("next");
        await evidence.CompleteAsync("next", "Succeeded", null);
        Assert.That(sent.Single().Terminal!.RequestId, Is.EqualTo("next"));
        Assert.That(evidence.Snapshot().Terminals, Is.Empty);
    }

    [Test]
    public void OrdinaryCompletionLeavesNoUncertainEvidence() {
        var evidence = new BridgeRequestEvidence();
        evidence.Begin("normal");
        evidence.Forget("normal");
        Assert.That(evidence.Snapshot().Requests, Is.Empty);
        Assert.That(evidence.Snapshot().Terminals, Is.Empty);
    }
}
