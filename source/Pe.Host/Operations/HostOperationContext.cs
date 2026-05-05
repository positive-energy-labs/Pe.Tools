using Pe.Aps.Auth;
using Pe.Host.Services;

namespace Pe.Host.Operations;

internal sealed class HostOperationContext(
    ApsAuthService apsAuthService,
    BridgeServer bridgeServer,
    IHostScriptingPipeClientService scriptingPipeClientService,
    HostSettingsRuntimeStateService runtimeStateService,
    HostSettingsStorageService storageService,
    ILoggerFactory loggerFactory
) {
    public ApsAuthService ApsAuthService { get; } = apsAuthService;
    public BridgeServer BridgeServer { get; } = bridgeServer;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
    public IHostScriptingPipeClientService ScriptingPipeClientService { get; } = scriptingPipeClientService;
    public HostSettingsRuntimeStateService RuntimeStateService { get; } = runtimeStateService;
    public HostSettingsStorageService StorageService { get; } = storageService;

    public static HostOperationContext Create(IServiceProvider services) =>
        new(
            services.GetRequiredService<ApsAuthService>(),
            services.GetRequiredService<BridgeServer>(),
            services.GetRequiredService<IHostScriptingPipeClientService>(),
            services.GetRequiredService<HostSettingsRuntimeStateService>(),
            services.GetRequiredService<HostSettingsStorageService>(),
            services.GetRequiredService<ILoggerFactory>()
        );
}
