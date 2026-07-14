using Pe.Revit.Global.Services.Host;
using Pe.Revit.Tasks;
using Serilog;
using System.Threading.Channels;

namespace Pe.App.Host;

internal sealed class BridgeConnectionSupervisor : IDisposable {
    private static readonly TimeSpan InitialRetryDelay = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromSeconds(30);

    private readonly CancellationTokenSource _shutdown = new();
    private readonly Channel<string> _reconnectRequests = Channel.CreateUnbounded<string>(new UnboundedChannelOptions {
        SingleReader = true,
        SingleWriter = false
    });
    private readonly RevitTaskQueue _revitTaskQueue;
    private int _started;
    private Task? _runTask;

    public BridgeConnectionSupervisor(RevitTaskQueue revitTaskQueue) =>
        this._revitTaskQueue = revitTaskQueue;

    public void Start() {
        if (Interlocked.Exchange(ref this._started, 1) == 1)
            return;

        this._runTask = Task.Run(this.RunAsync);
        this.RequestReconnect("startup");
    }

    public void RequestReconnect(string? reason) {
        if (this._shutdown.IsCancellationRequested)
            return;

        _ = this._reconnectRequests.Writer.TryWrite(reason ?? "requested");
    }

    public void Dispose() {
        if (this._shutdown.IsCancellationRequested)
            return;

        this._shutdown.Cancel();
        this._reconnectRequests.Writer.TryComplete();
        this._shutdown.Dispose();
    }

    private async Task RunAsync() {
        var cancellationToken = this._shutdown.Token;
        var retryDelay = InitialRetryDelay;

        try {
            while (!cancellationToken.IsCancellationRequested) {
                var reason = await this.WaitForReconnectRequestAsync(null, cancellationToken).ConfigureAwait(false);
                if (reason == null)
                    continue;

                this.DrainReconnectRequests(out var latestReason);
                reason = latestReason ?? reason;

                while (!cancellationToken.IsCancellationRequested) {
                    var result = await this.TryConnectAsync(reason, cancellationToken).ConfigureAwait(false);
                    if (result.Success) {
                        retryDelay = InitialRetryDelay;
                        break;
                    }

                    Log.Warning(
                        "Host bridge supervisor connect attempt failed. Retrying in {RetryDelaySeconds:0.#} seconds: {Message}",
                        retryDelay.TotalSeconds,
                        result.Message
                    );

                    reason = await this.WaitForReconnectRequestAsync(retryDelay, cancellationToken).ConfigureAwait(false)
                             ?? $"retry after {retryDelay.TotalSeconds:0.#}s";
                    this.DrainReconnectRequests(out latestReason);
                    reason = latestReason ?? reason;
                    retryDelay = NextRetryDelay(retryDelay);
                }
            }
        } catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) {
            // Expected on shutdown.
        } catch (Exception ex) {
            Log.Error(ex, "Host bridge supervisor stopped unexpectedly.");
        }
    }

    private async Task<RuntimeActionResult> TryConnectAsync(string reason, CancellationToken cancellationToken) {
        Log.Information("Host bridge supervisor connect requested: Reason={Reason}", reason);

        var hostLaunchResult = HostBridgeConnector.EnsureTsHostRunning();
        if (!hostLaunchResult.Success)
            return new RuntimeActionResult(false, hostLaunchResult.Message);

        cancellationToken.ThrowIfCancellationRequested();
        return await this.ConnectRuntimeAsync(cancellationToken).ConfigureAwait(false);
    }

    private async Task<RuntimeActionResult> ConnectRuntimeAsync(CancellationToken cancellationToken) {
        return await this._revitTaskQueue.Run(
            _ => HostBridgeConnector.ConnectRuntime(),
            ct: cancellationToken
        ).ConfigureAwait(false);
    }

    private async Task<string?> WaitForReconnectRequestAsync(TimeSpan? timeout, CancellationToken cancellationToken) {
        if (timeout == null)
            return await this._reconnectRequests.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);

        var readTask = this._reconnectRequests.Reader.WaitToReadAsync(cancellationToken).AsTask();
        var delayTask = Task.Delay(timeout.Value, cancellationToken);
        var completedTask = await Task.WhenAny(readTask, delayTask).ConfigureAwait(false);
        if (completedTask != readTask)
            return null;

        if (!await readTask.ConfigureAwait(false))
            return null;

        return this._reconnectRequests.Reader.TryRead(out var reason) ? reason : null;
    }

    private void DrainReconnectRequests(out string? latestReason) {
        latestReason = null;
        while (this._reconnectRequests.Reader.TryRead(out var reason))
            latestReason = reason;
    }

    private static TimeSpan NextRetryDelay(TimeSpan currentDelay) {
        var nextSeconds = Math.Min(currentDelay.TotalSeconds * 2, MaxRetryDelay.TotalSeconds);
        return TimeSpan.FromSeconds(nextSeconds);
    }
}
