using Pe.Shared.HostContracts.RevitData;

namespace Pe.Host.Services;

public interface IHostBridgeCapabilityService {
    BridgeRuntimeSnapshot GetSnapshot();
}

public sealed class HostBridgeCapabilityService(BridgeServer bridgeServer) : IHostBridgeCapabilityService {
    private readonly BridgeServer _bridgeServer = bridgeServer;

    public BridgeRuntimeSnapshot GetSnapshot() => this._bridgeServer.GetSnapshot();
}
