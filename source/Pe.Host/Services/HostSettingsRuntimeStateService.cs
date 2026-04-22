using Pe.Shared.HostContracts.Protocol;

namespace Pe.Host.Services;

public sealed record HostSettingsRuntimeState(
    BridgeRuntimeSnapshot BridgeSnapshot,
    IReadOnlyList<HostModuleDescriptor> CatalogModules
);

public sealed class HostSettingsRuntimeStateService(
    IHostBridgeCapabilityService bridgeCapabilityService
) {
    private readonly IHostBridgeCapabilityService _bridgeCapabilityService = bridgeCapabilityService;

    public HostSettingsRuntimeState GetState() {
        var snapshot = this._bridgeCapabilityService.GetSnapshot();
        return new HostSettingsRuntimeState(snapshot, HostSettingsModuleCatalog.GetCatalogDescriptors(snapshot));
    }
}