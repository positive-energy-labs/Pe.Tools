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
    HostActivityService activityService,
    BridgeServer bridgeServer,
    BridgeHostOptions options,
    IHostApplicationLifetime applicationLifetime,
    ILogger<HostIdleMonitorService> logger
) : BackgroundService {
    private static readonly TimeSpan CheckInterval = TimeSpan.FromMinutes(1);
    private readonly IHostApplicationLifetime _applicationLifetime = applicationLifetime;
    private readonly HostActivityService _activityService = activityService;
    private readonly BridgeServer _bridgeServer = bridgeServer;
    private readonly ILogger<HostIdleMonitorService> _logger = logger;
    private readonly BridgeHostOptions _options = options;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken) {
        if (!this._options.IdleShutdownEnabled) {
            this._logger.LogInformation("Host idle shutdown is disabled.");
            return;
        }

        using var timer = new PeriodicTimer(CheckInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken)) {
            var snapshot = this._bridgeServer.GetSnapshot();
            if (snapshot.BridgeIsConnected)
                continue;

            if (this._activityService.GetActiveRequestCount() != 0)
                continue;

            var idleFor = DateTime.UtcNow - this._activityService.GetLastRequestUtc();
            if (idleFor < this._options.IdleShutdownTimeout)
                continue;

            this._logger.LogInformation(
                "Host idle shutdown triggered after {IdleMinutes:0.#} minutes without HTTP activity and with no connected Revit sessions.",
                idleFor.TotalMinutes
            );
            this._applicationLifetime.StopApplication();
            return;
        }
    }
}
