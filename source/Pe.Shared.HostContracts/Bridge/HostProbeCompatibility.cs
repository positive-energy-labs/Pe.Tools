using Pe.Shared.HostContracts;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.Product;

namespace Pe.Shared.HostContracts.Bridge;

public static class HostProbeCompatibility {
    public static bool IsCompatible(HostProbeData? probe) =>
        DescribeIncompatibility(probe) == null;

    public static string? DescribeIncompatibility(HostProbeData? probe) {
        if (probe == null)
            return "Host probe returned no data.";

        if (!string.Equals(probe.RuntimeIdentity, HostProcessIdentity.RuntimeIdentity, StringComparison.Ordinal))
            return $"Runtime identity mismatch. Expected '{HostProcessIdentity.RuntimeIdentity}', received '{probe.RuntimeIdentity}'.";

        if (probe.HostContractVersion != HostProtocol.ContractVersion)
            return $"Host contract mismatch. Expected {HostProtocol.ContractVersion}, received {probe.HostContractVersion}.";

        if (probe.BridgeContractVersion != BridgeProtocol.ContractVersion)
            return $"Bridge contract mismatch. Expected {BridgeProtocol.ContractVersion}, received {probe.BridgeContractVersion}.";

        if (!string.Equals(probe.BridgePath, HttpRoutes.Bridge, StringComparison.Ordinal))
            return $"Bridge path mismatch. Expected '{HttpRoutes.Bridge}', received '{probe.BridgePath}'.";

        return null;
    }
}
