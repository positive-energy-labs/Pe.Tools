using Pe.Host.Services;

namespace Pe.Host.Operations;

internal sealed class HostOperationContext(
    BridgeServer bridgeServer,
    HostSchemaService schemaService,
    HostSettingsRuntimeStateService runtimeStateService,
    HostSettingsStorageService storageService,
    ILoggerFactory loggerFactory
) {
    public BridgeServer BridgeServer { get; } = bridgeServer;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
    public HostSchemaService SchemaService { get; } = schemaService;
    public HostSettingsRuntimeStateService RuntimeStateService { get; } = runtimeStateService;
    public HostSettingsStorageService StorageService { get; } = storageService;

    public static HostOperationContext Create(IServiceProvider services) =>
        new(
            services.GetRequiredService<BridgeServer>(),
            services.GetRequiredService<HostSchemaService>(),
            services.GetRequiredService<HostSettingsRuntimeStateService>(),
            services.GetRequiredService<HostSettingsStorageService>(),
            services.GetRequiredService<ILoggerFactory>()
        );
}
