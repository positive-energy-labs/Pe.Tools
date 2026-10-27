using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Runtime.Serialization;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.ports` contract: a bounded exact-element detail read beside `ducts.snapshot`, never folded into it.

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
public sealed record DuctPortsData(string DocumentTitle, DateTimeOffset ReadAtUtc, bool NetworkBasedCalculations,
    IReadOnlyList<DuctPortElement> Elements);

public sealed record DuctPortElement(long ElementId, DuctElementLevel Level, IReadOnlyList<DuctPhysicalPort> Ports);

/// <summary>Element.LevelId as Revit reports it (a duct's reference level, an instance's level). Absent when Revit reports no level; never inferred from elevation.</summary>
public sealed record DuctElementLevel(DuctReadState State, long? Id, string? Name, string? Error);

/// <summary>One physical HVAC End/Curve port. Raw connector axes; BasisZ is approach orientation, not airflow direction.</summary>
public sealed record DuctPhysicalPort(int ConnectorId, string Kind, double[] OriginFt,
    double[] BasisX, double[] BasisY, double[] BasisZ,
    DuctShape Shape, double? DiameterIn, double? WidthIn, double? HeightIn, bool IsConnected,
    IReadOnlyList<DuctRef> PhysicalPeers,
    DuctPortSystem System, DuctPortDirection Direction, DuctPortFlow RevitFlow, DuctPortFlow AssignedFlow,
    DuctFlowParameter FlowParameter);

/// <summary>How one optional port fact read went. Only `value` carries data; a failed fact never fails its port row.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum DuctReadState {
    /// <summary>Read; the value fields hold it, and 0 is a known zero.</summary>
    [EnumMember(Value = "value")] Value,
    /// <summary>Known absence: Revit reported no system or no associated parameter, or the read is withheld as unsafe. Never zero, never inferred.</summary>
    [EnumMember(Value = "absent")] Absent,
    /// <summary>The read threw or did not resolve to exactly one airflow parameter. Unknown, not zero; `error` keeps the exception type and message.</summary>
    [EnumMember(Value = "error")] Error
}

/// <summary>The connector's MEP system as Revit reports it: the system element, its system type element (GetTypeId), and the MechanicalSystem classification. Membership only, not design intent.</summary>
public sealed record DuctPortSystem(DuctReadState State, long? Id, string? Name, long? TypeId, string? Classification, string? Error);

/// <summary>Connector.Direction as Revit reports it (in, out, bidirectional); never derived from BasisZ.</summary>
public sealed record DuctPortDirection(DuctReadState State, string? Value, string? Error);

/// <summary>A connector flow in CFM. `revitFlow` is Connector.Flow (Revit-calculated; absent under network-based calculations, where the getter can crash Revit); `assignedFlow` is Connector.AssignedFlow (the connector's preset flow). Neither is the family flow input, and neither is design intent.</summary>
public sealed record DuctPortFlow(DuctReadState State, double? Cfm, string? Error);

/// <summary>The element parameter the family associates with this connector's Flow (RBS_DUCT_FLOW_PARAM); `provenance` names how it was matched. Absent means unknown demand provenance, not zero demand.</summary>
public sealed record DuctFlowParameter(DuctReadState State, long? Id, string? Name, string? Guid, bool? Writable,
    bool? HasValue, double? Cfm, string? Provenance, string? Error);
