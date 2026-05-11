using Pe.Aps.Auth;
using Pe.Host.Services;

namespace Pe.Host.Operations;

internal sealed class HostOperationContext(
    ApsAuthService apsAuthService,
    BridgeServer bridgeServer,
    HostSettingsStorageService storageService,
    ILoggerFactory loggerFactory
) {
    public ApsAuthService ApsAuthService { get; } = apsAuthService;
    public BridgeServer BridgeServer { get; } = bridgeServer;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
    public HostSettingsStorageService StorageService { get; } = storageService;

    public static HostOperationContext Create(IServiceProvider services) =>
        new(
            services.GetRequiredService<ApsAuthService>(),
            services.GetRequiredService<BridgeServer>(),
            services.GetRequiredService<HostSettingsStorageService>(),
            services.GetRequiredService<ILoggerFactory>()
        );
}
