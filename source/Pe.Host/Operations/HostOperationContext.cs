using Pe.Host.Services;

namespace Pe.Host.Operations;

internal sealed class HostOperationContext(
    BridgeServer bridgeServer,
    HostSchemaService schemaService,
    IHostScriptingPipeClientService scriptingPipeClientService,
    HostSettingsRuntimeStateService runtimeStateService,
    HostSettingsStorageService storageService,
    ILoggerFactory loggerFactory
) {
    public BridgeServer BridgeServer { get; } = bridgeServer;
    public ILoggerFactory LoggerFactory { get; } = loggerFactory;
    public HostSchemaService SchemaService { get; } = schemaService;
    public IHostScriptingPipeClientService ScriptingPipeClientService { get; } = scriptingPipeClientService;
    public HostSettingsRuntimeStateService RuntimeStateService { get; } = runtimeStateService;
    public HostSettingsStorageService StorageService { get; } = storageService;

    public static HostOperationContext Create(IServiceProvider services) =>
        new(
            services.GetRequiredService<BridgeServer>(),
            services.GetRequiredService<HostSchemaService>(),
            services.GetRequiredService<IHostScriptingPipeClientService>(),
            services.GetRequiredService<HostSettingsRuntimeStateService>(),
            services.GetRequiredService<HostSettingsStorageService>(),
            services.GetRequiredService<ILoggerFactory>()
        );
}
