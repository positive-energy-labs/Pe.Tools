using Pe.Shared.HostContracts.Protocol;

namespace Pe.Host.Services;

public sealed record HostSettingsRuntimeState(
    BridgeRuntimeSnapshot BridgeSnapshot,
    IReadOnlyList<HostModuleDescriptor> AvailableModules
);

public sealed class HostSettingsRuntimeStateService(
    IHostSettingsModuleCatalog moduleCatalog,
    IHostBridgeCapabilityService bridgeCapabilityService
) {
    private readonly IHostBridgeCapabilityService _bridgeCapabilityService = bridgeCapabilityService;
    private readonly IHostSettingsModuleCatalog _moduleCatalog = moduleCatalog;

    public HostSettingsRuntimeState GetState() =>
        new(
            this._bridgeCapabilityService.GetSnapshot(),
            this._moduleCatalog.GetTransportDescriptors()
        );
}
