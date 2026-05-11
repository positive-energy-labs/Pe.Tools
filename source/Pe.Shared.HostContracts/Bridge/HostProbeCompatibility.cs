using Pe.Shared.HostContracts;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.Product;

namespace Pe.Shared.HostContracts.Bridge;

public static class HostProbeCompatibility {
    public static bool IsCompatible(HostProbeData? probe) =>
        probe != null
        && string.Equals(probe.RuntimeIdentity, HostProcessIdentity.RuntimeIdentity, StringComparison.Ordinal)
        && probe.HostContractVersion == HostProtocol.ContractVersion
        && probe.BridgeContractVersion == BridgeProtocol.ContractVersion
        && string.Equals(probe.BridgePath, HttpRoutes.Bridge, StringComparison.Ordinal);
}
