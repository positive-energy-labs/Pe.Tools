using Newtonsoft.Json;

namespace Pe.Shared.RevitData.Ducts;

/// <summary>Inspect only these known project elements. IDs belong to the current exact open document.</summary>
public sealed record DuctPortsRequest([property: JsonRequired] IReadOnlyList<long> ElementIds) {
    public const int MaxElements = 32;

    public IReadOnlyList<long> UniqueElementIds() {
        if (ElementIds is null || ElementIds.Count is 0 or > MaxElements || ElementIds.Any(id => id <= 0))
            throw new ArgumentException($"elementIds must contain 1 to {MaxElements} positive element IDs.");
        return ElementIds.Distinct().ToArray();
    }
}

/// <summary>Exact live port geometry in host-model internal feet; read connector IDs again after regeneration.</summary>
public sealed record DuctPortsData(string DocumentTitle, DateTimeOffset ReadAtUtc,
    IReadOnlyList<DuctPortElement> Elements);

public sealed record DuctPortElement(long ElementId, IReadOnlyList<DuctPhysicalPort> Ports);

/// <summary>One physical HVAC End/Curve port. Raw connector axes; BasisZ is approach orientation, not airflow direction.</summary>
public sealed record DuctPhysicalPort(int ConnectorId, string Kind, double[] OriginFt,
    double[] BasisX, double[] BasisY, double[] BasisZ,
    DuctShape Shape, double? DiameterIn, double? WidthIn, double? HeightIn, bool IsConnected,
    IReadOnlyList<DuctRef> PhysicalPeers);
