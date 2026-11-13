using Pe.Shared.HostContracts.Operations;
using System.Collections.Concurrent;

namespace Pe.Shared.HostContracts.Bridge;

/// <summary>Cancel one in-flight bridge request by the id the caller sent it under.</summary>
public record OpCancelRequest(string RequestId);

public record OpCancelData(bool Cancelled, string RequestId, string Message);

/// <summary>A cancelled op whose runner already knows what it touched; the pump puts that on the cancelled frame.</summary>
public sealed class OpCancelledException(Touched touched, OperationCanceledException inner)
    : OperationCanceledException(inner.Message, inner, inner.CancellationToken) {
    public Touched Touched { get; } = touched;
}

/// <summary>
///     The bridge read loop: reads frames off one socket and dispatches each request without
///     waiting for it to finish. Waiting is what made a cancel frame unreachable — it sat in the
///     socket buffer behind the very op it was meant to stop. Concurrency here is frame-reading
///     only: Revit-thread ops still serialize through the Revit task queue, and one writer at a
///     time holds <see cref="BridgeTransportSession" />'s write lock, so frames never interleave.
/// </summary>
public sealed class BridgeRequestPump(
    BridgeTransportSession session,
    Func<BridgeRequest, CancellationToken, Task> handle,
    Action<string, Exception?>? log = null
) {
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _inFlight = new(StringComparer.Ordinal);

    public async Task RunAsync(CancellationToken cancellationToken) {
        while (!cancellationToken.IsCancellationRequested && session.IsConnected) {
            var frame = await session.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (frame == null)
                return;
            if (frame.Request == null || frame.Kind != BridgeFrameKind.Request) {
                log?.Invoke($"Host bridge read loop ignored frame: Kind={frame.Kind}", null);
                continue;
            }

            this.Dispatch(frame.Request, cancellationToken);
        }
    }

    // The `op.cancel` handler is BridgeAgent.CancelAsync, not this method: a SessionWrite op takes its scope in
    // its signature, and this assembly references no Revit to name one.
    public Task<OpCancelData> CancelAsync(OpCancelRequest request, CancellationToken cancellationToken) {
        // Never queued behind anything: reaching an op that is hogging Revit is the whole point.
        var requestId = request.RequestId ?? string.Empty;
        if (!this._inFlight.TryGetValue(requestId, out var source))
            return Task.FromResult(new OpCancelData(
                false,
                requestId,
                $"Request '{requestId}' is not in flight; nothing to cancel."
            ));

        source.Cancel();
        return Task.FromResult(new OpCancelData(
            true,
            requestId,
            $"Cancellation signalled to request '{requestId}'. It stops at its next cooperative checkpoint."
        ));
    }

    private void Dispatch(BridgeRequest request, CancellationToken cancellationToken) {
        var source = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        // A duplicate requestId is the caller's mistake, not a reason to drop the op: it runs,
        // it just is not addressable by op.cancel while its twin holds the name.
        var tracked = this._inFlight.TryAdd(request.RequestId, source);
        if (!tracked)
            log?.Invoke($"Host bridge request '{request.RequestId}' is already in flight; it cannot be cancelled by id.", null);

        _ = Task.Run(async () => {
            try {
                await handle(request, source.Token).ConfigureAwait(false);
            } catch (OperationCanceledException cancelled) when (source.IsCancellationRequested) {
                await this.WriteCancelledAsync(request, (cancelled as OpCancelledException)?.Touched).ConfigureAwait(false);
            } catch (Exception exception) {
                log?.Invoke($"Host bridge request '{request.RequestId}' escaped its handler.", exception);
            } finally {
                if (tracked)
                    _ = this._inFlight.TryRemove(request.RequestId, out _);
                source.Dispose();
            }
        }, CancellationToken.None);
    }

    /// <summary>
    ///     A cancelled op answers cancelled (499), never a fault, with the same touched its receipt states. Null when
    ///     the op was cancelled before a runner saw it; the host reads that as unknown.
    /// </summary>
    private async Task WriteCancelledAsync(BridgeRequest request, Touched? touched) {
        var message = $"Operation '{request.OperationKey}' was cancelled.";
        try {
            await session.WriteAsync(
                new BridgeFrame(
                    BridgeFrameKind.Response,
                    Response: new BridgeResponse(
                        request.RequestId,
                        false,
                        null,
                        message,
                        BridgeOperationExceptions.CancelledStatusCode,
                        [BridgeOperationExceptions.Issue("$", "Cancelled", message, null)],
                        new PerformanceMetrics(0, 0, 0, 0, 0),
                        Touched: touched
                    )
                ),
                CancellationToken.None
            ).ConfigureAwait(false);
        } catch (Exception exception) {
            log?.Invoke($"Host bridge could not answer cancelled for request '{request.RequestId}'.", exception);
        }
    }
}
