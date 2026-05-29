using Pe.Aps.Auth;
using Pe.Host.Services;

namespace Pe.Host.Operations;

internal sealed class HostOperationContext(
    ApsAuthService apsAuthService,
    BridgeServer bridgeServer,
    HostSettingsStorageService storageService,
    ILoggerFactory loggerFactory,
    string? requestId = null
) {
    public ApsAuthService ApsAuthService { get; } = apsAuthService;
    public BridgeServer BridgeServer { get; } = bridgeServer;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
    public string RequestId { get; } = string.IsNullOrWhiteSpace(requestId) ? Guid.NewGuid().ToString("N") : requestId.Trim();
    public HostSettingsStorageService StorageService { get; } = storageService;

    public static HostOperationContext Create(IServiceProvider services, string? requestId = null) =>
        new(
            services.GetRequiredService<ApsAuthService>(),
            services.GetRequiredService<BridgeServer>(),
            services.GetRequiredService<HostSettingsStorageService>(),
            services.GetRequiredService<ILoggerFactory>(),
            requestId
        );
}
