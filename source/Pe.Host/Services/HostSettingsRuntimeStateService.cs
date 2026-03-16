using Pe.Host.Contracts;

namespace Pe.Host.Services;

public sealed record HostSettingsRuntimeState(
    ProviderMode ProviderMode,
    BridgeSnapshot BridgeSnapshot,
    IReadOnlyList<SettingsModuleDescriptor> AvailableModules
);

public sealed class HostSettingsRuntimeStateService(
    IHostSettingsModuleCatalog moduleCatalog,
    IHostBridgeCapabilityService bridgeCapabilityService
) {
    private readonly IHostBridgeCapabilityService _bridgeCapabilityService = bridgeCapabilityService;
    private readonly IHostSettingsModuleCatalog _moduleCatalog = moduleCatalog;

    public HostSettingsRuntimeState GetState() =>
        new(
            this._bridgeCapabilityService.GetProviderMode(),
            this._bridgeCapabilityService.GetSnapshot(),
            this._moduleCatalog.GetTransportDescriptors()
        );
}