namespace Pe.Shared.HostContracts.Bridge;

/// <summary>
///     The bridge read loop: reads frames off one socket and hands each request to the agent's
///     handler. Owns nothing about what an op means — only the order frames are taken off the wire.
/// </summary>
public sealed class BridgeRequestPump(
    BridgeTransportSession session,
    Func<BridgeRequest, CancellationToken, Task> handle,
    Action<string, Exception?>? log = null
) {
    public async Task RunAsync(CancellationToken cancellationToken) {
        while (!cancellationToken.IsCancellationRequested && session.IsConnected) {
            var frame = await session.ReadAsync(cancellationToken).ConfigureAwait(false);
            if (frame == null)
                return;
            if (frame.Request == null || frame.Kind != BridgeFrameKind.Request) {
                log?.Invoke($"Host bridge read loop ignored frame: Kind={frame.Kind}", null);
                continue;
            }

            await handle(frame.Request, cancellationToken).ConfigureAwait(false);
        }
    }
}
