using System.Diagnostics;

namespace Pe.Shared.HostContracts.Bridge;

/// <summary>Process-owned evidence survives socket replacement. Only unsent terminals are retained.</summary>
public sealed class BridgeRequestEvidence {
    private readonly object _gate = new();
    private readonly Dictionary<string, BridgeInFlightRequest> _running = new(StringComparer.Ordinal);
    private readonly Dictionary<string, BridgeTerminal> _pending = new(StringComparer.Ordinal);
    private Func<BridgeFrame, Task>? _send;
    public int ProcessId { get; }
    public long ProcessStartUtcUnixMs { get; }

    public BridgeRequestEvidence() {
        // Capture both identity components from the same process handle, never from separate providers.
        using var process = Process.GetCurrentProcess();
        ProcessId = process.Id;
        ProcessStartUtcUnixMs = new DateTimeOffset(process.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds();
    }

    public void Begin(string requestId) {
        lock (_gate)
            _running.Add(requestId, new(requestId, "Running", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
    }

    public void Uncertain(string requestId, string state) {
        lock (_gate)
            _running[requestId] = _running[requestId] with { State = state };
    }

    public void Forget(string requestId) {
        lock (_gate) _running.Remove(requestId);
    }

    public BridgeInFlightSnapshot Snapshot() {
        lock (_gate)
            return new(ProcessId, ProcessStartUtcUnixMs, _running.Values.ToList(), _pending.Values.ToList());
    }

    public async Task AttachAsync(Func<BridgeFrame, Task> send) {
        BridgeTerminal[] pending;
        lock (_gate) { _send = send; pending = _pending.Values.ToArray(); }
        foreach (var terminal in pending) await SendAsync(terminal).ConfigureAwait(false);
    }

    public void Detach(Func<BridgeFrame, Task> send) {
        lock (_gate) { if (_send == send) _send = null; }
    }

    public async Task CompleteWhenFinishedAsync(string requestId, Task completion, string? receiptId) {
        var outcome = "Succeeded";
        try { await completion.ConfigureAwait(false); }
        catch (OperationCanceledException) { outcome = "Cancelled"; }
        catch (Exception) { outcome = "Failed"; }
        await CompleteAsync(requestId, outcome, receiptId).ConfigureAwait(false);
    }

    public async Task CompleteAsync(string requestId, string outcome, string? receiptId) {
        BridgeTerminal terminal;
        lock (_gate) {
            if (!_running.TryGetValue(requestId, out var request)) return;
            _running.Remove(requestId);
            terminal = new(requestId, outcome, request.StartedAtUnixMs,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), receiptId);
            _pending.Add(requestId, terminal);
        }
        await SendAsync(terminal).ConfigureAwait(false);
    }

    private async Task SendAsync(BridgeTerminal terminal) {
        Func<BridgeFrame, Task>? send;
        lock (_gate) send = _send;
        if (send is null) return;
        try {
            await send(new(BridgeFrameKind.Terminal, Terminal: terminal)).ConfigureAwait(false);
            lock (_gate) _pending.Remove(terminal.RequestId);
        } catch {
            // A broken socket keeps the same terminal for the next registration and replay.
        }
    }
}
