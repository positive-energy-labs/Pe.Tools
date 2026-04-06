using Pe.Shared.HostContracts.RevitData;

namespace Pe.Host.Services;

public interface IHostBridgeCapabilityService {
    BridgeSnapshot GetSnapshot();
}

public sealed class HostBridgeCapabilityService(BridgeServer bridgeServer) : IHostBridgeCapabilityService {
    private readonly BridgeServer _bridgeServer = bridgeServer;

    public BridgeSnapshot GetSnapshot() => this._bridgeServer.GetSnapshot();
}
