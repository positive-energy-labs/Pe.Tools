using Pe.Host.Operations;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.SettingsStorage;
using System.Collections.Concurrent;

namespace Pe.Host;

public sealed class BridgeRequestGate {
    private readonly ConcurrentDictionary<string, PendingBridgeRequest> _pending = new(StringComparer.Ordinal);
    private readonly object _admissionSync = new();
    private InFlightBridgeRequest? _inFlightRequest;

    internal BridgeRequestLease Admit(string requestId, string method, long startedAtUnixMs) {
        var request = new InFlightBridgeRequest(requestId, method, startedAtUnixMs);
        lock (this._admissionSync) {
            if (this._inFlightRequest == null) {
                this._inFlightRequest = request;
                return new BridgeRequestLease(this, requestId);
            }

            throw CreateBusyException(this._inFlightRequest);
        }
    }

    internal BridgeRegistrationResult RegisterOrReject(
        BridgeSessionManager sessionManager,
        Func<BridgeRegistrationResult> register
    ) {
        lock (this._admissionSync) {
            if (this._inFlightRequest != null) {
                var existing = sessionManager.GetSnapshot().ConnectedSession;
                var elapsedMs = GetElapsedMs(this._inFlightRequest);
                return new BridgeRegistrationResult(
                    null,
                    new BridgeRegistrationAck(
                        false,
                        $"A Revit bridge session is busy executing '{this._inFlightRequest.Method}' for {elapsedMs} ms. Retry after the current operation completes.",
                        existing?.SessionId,
                        existing?.ProcessId
                    )
                );
            }

            return register();
        }
    }

    internal TaskCompletionSource<BridgeResponse> Track(
        string connectionId,
        string requestId
    ) {
        var completion = new TaskCompletionSource<BridgeResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!this._pending.TryAdd(requestId, new PendingBridgeRequest(connectionId, completion)))
            throw new InvalidOperationException($"Duplicate bridge request ID '{requestId}'.");

        return completion;
    }

    internal void Remove(string requestId) =>
        _ = this._pending.TryRemove(requestId, out _);

    internal bool TryCompleteResponse(string connectionId, BridgeResponse response) {
        if (!this._pending.TryRemove(response.RequestId, out var pending) || pending.ConnectionId != connectionId)
            return false;

        return pending.Completion.TrySetResult(response);
    }

    internal void FailConnection(string connectionId, string reason) {
        foreach (var pending in this._pending.ToArray()) {
            if (pending.Value.ConnectionId != connectionId)
                continue;

            if (this._pending.TryRemove(pending.Key, out var completion)) {
                _ = completion.Completion.TrySetException(
                    new HostOperationException(
                        StatusCodes.Status503ServiceUnavailable,
                        $"Revit bridge disconnected: {reason}",
                        bridgePrecondition: "Connect the Revit bridge before retrying."
                    )
                );
            }
        }
    }

    private void Release(string requestId) {
        lock (this._admissionSync) {
            if (this._inFlightRequest != null &&
                string.Equals(this._inFlightRequest.RequestId, requestId, StringComparison.Ordinal)) {
                this._inFlightRequest = null;
            }
        }
    }

    private static HostOperationException CreateBusyException(InFlightBridgeRequest request) {
        var elapsedMs = GetElapsedMs(request);
        return new HostOperationException(
            StatusCodes.Status423Locked,
            $"Revit bridge is busy executing '{request.Method}' for {elapsedMs} ms. Retry after the current operation completes.",
            [
                new ValidationIssue(
                    "$",
                    null,
                    "RevitBridgeBusy",
                    "error",
                    $"The Revit bridge is already executing '{request.Method}'.",
                    "Retry after the current operation completes."
                )
            ],
            activeOperation: request.Method,
            retryHint: "Retry after the current operation completes.",
            bridgePrecondition: "Only one Revit bridge request can execute at a time."
        );
    }

    private static long GetElapsedMs(InFlightBridgeRequest request) =>
        Math.Max(0, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - request.StartedAtUnixMs);

    internal sealed class BridgeRequestLease : IDisposable {
        private readonly BridgeRequestGate _gate;
        private readonly string _requestId;
        private bool _disposed;

        public BridgeRequestLease(BridgeRequestGate gate, string requestId) {
            this._gate = gate;
            this._requestId = requestId;
        }

        public void Dispose() {
            if (this._disposed)
                return;

            this._disposed = true;
            this._gate.Release(this._requestId);
        }
    }
}

internal sealed record PendingBridgeRequest(
    string ConnectionId,
    TaskCompletionSource<BridgeResponse> Completion
);

internal sealed record InFlightBridgeRequest(
    string RequestId,
    string Method,
    long StartedAtUnixMs
);
