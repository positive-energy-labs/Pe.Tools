namespace Pe.Host.Services;

public sealed class HostLifecycleCoordinator(
    HostActivityService activityService,
    BridgeServer bridgeServer,
    BridgeHostOptions options,
    IHostApplicationLifetime applicationLifetime,
    ILogger<HostLifecycleCoordinator> logger
) {
    private static readonly TimeSpan IdleCheckInterval = TimeSpan.FromMinutes(1);
    private readonly HostActivityService _activityService = activityService;
    private readonly IHostApplicationLifetime _applicationLifetime = applicationLifetime;
    private readonly BridgeServer _bridgeServer = bridgeServer;
    private readonly ILogger<HostLifecycleCoordinator> _logger = logger;
    private readonly BridgeHostOptions _options = options;

    public void OnRequestStarted() => this._activityService.OnRequestStarted();

    public void OnRequestCompleted() => this._activityService.OnRequestCompleted();

    internal Task StopWhenTakeoverRequestedAsync(HostSingletonLease singletonLease) =>
        singletonLease.StopWhenTakeoverRequestedAsync(this._applicationLifetime);

    public async Task RunIdleShutdownMonitorAsync(CancellationToken stoppingToken) {
        if (!this._options.IdleShutdownEnabled) {
            this._logger.LogInformation("Host idle shutdown is disabled.");
            return;
        }

        using var timer = new PeriodicTimer(IdleCheckInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken)) {
            var decision = this.EvaluateIdleShutdown();
            if (!decision.ShouldStop)
                continue;

            this._logger.LogInformation(
                "Host idle shutdown triggered after {IdleMinutes:0.#} minutes without HTTP activity and with no connected Revit sessions.",
                decision.IdleFor.TotalMinutes
            );
            this._applicationLifetime.StopApplication();
            return;
        }
    }

    private HostIdleShutdownDecision EvaluateIdleShutdown() {
        var snapshot = this._bridgeServer.GetSnapshot();
        if (snapshot.BridgeIsConnected)
            return HostIdleShutdownDecision.KeepAlive(TimeSpan.Zero);

        if (this._activityService.GetActiveRequestCount() != 0)
            return HostIdleShutdownDecision.KeepAlive(TimeSpan.Zero);

        var idleFor = DateTime.UtcNow - this._activityService.GetLastRequestUtc();
        return idleFor >= this._options.IdleShutdownTimeout
            ? HostIdleShutdownDecision.Stop(idleFor)
            : HostIdleShutdownDecision.KeepAlive(idleFor);
    }
}

internal sealed record HostIdleShutdownDecision(bool ShouldStop, TimeSpan IdleFor) {
    public static HostIdleShutdownDecision Stop(TimeSpan idleFor) => new(true, idleFor);

    public static HostIdleShutdownDecision KeepAlive(TimeSpan idleFor) => new(false, idleFor);
}
