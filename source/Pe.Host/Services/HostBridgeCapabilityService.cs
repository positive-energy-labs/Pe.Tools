using Pe.Host.Contracts;

namespace Pe.Host.Services;

public interface IHostBridgeCapabilityService {
    BridgeSnapshot GetSnapshot();

    ProviderMode GetProviderMode();
}

public sealed class HostBridgeCapabilityService(BridgeServer bridgeServer) : IHostBridgeCapabilityService {
    private readonly BridgeServer _bridgeServer = bridgeServer;

    public BridgeSnapshot GetSnapshot() => this._bridgeServer.GetSnapshot();

    public ProviderMode GetProviderMode() =>
        this._bridgeServer.IsConnected
            ? ProviderMode.BridgeEnhanced
            : ProviderMode.HostOnly;
}