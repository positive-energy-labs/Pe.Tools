namespace Pe.Host.Services;

public sealed class HostActivityService {
    private readonly object _sync = new();
    private int _activeRequestCount;
    private DateTime _lastRequestUtc = DateTime.UtcNow;

    public DateTime GetLastRequestUtc() {
        lock (this._sync)
            return this._lastRequestUtc;
    }

    public int GetActiveRequestCount() {
        lock (this._sync)
            return this._activeRequestCount;
    }

    public void OnRequestStarted() {
        lock (this._sync) {
            this._activeRequestCount++;
            this._lastRequestUtc = DateTime.UtcNow;
        }
    }

    public void OnRequestCompleted() {
        lock (this._sync) {
            if (this._activeRequestCount > 0)
                this._activeRequestCount--;

            this._lastRequestUtc = DateTime.UtcNow;
        }
    }
}

public sealed class HostIdleMonitorService(
    HostLifecycleCoordinator lifecycleCoordinator
) : BackgroundService {
    private readonly HostLifecycleCoordinator _lifecycleCoordinator = lifecycleCoordinator;

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        this._lifecycleCoordinator.RunIdleShutdownMonitorAsync(stoppingToken);
}
