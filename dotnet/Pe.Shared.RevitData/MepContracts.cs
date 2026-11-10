using Newtonsoft.Json;

namespace Pe.Shared.RevitData.Mep;

/// <summary>One optional fact: a value, absent (Revit has none), or the error raised reading it. Never a silent zero.</summary>
public enum MepReadState { Value, Absent, Error }
public sealed record MepFact<T>(MepReadState State,
    [property: JsonProperty(Required = Required.AllowNull, NullValueHandling = NullValueHandling.Include)] T? Value,
    string? Error = null);
public sealed record MepElementRef(string UniqueId, long ElementId, string Name);
public sealed record MepPeer(string UniqueId, long ElementId, int ConnectorId);
/// <summary>A physical connector. Direction is In, Out or Bidirectional exactly as Revit reports it; never inferred.</summary>
public sealed record MepPort(int ConnectorId, MepFact<string> Direction, IReadOnlyList<MepPeer> Peers);
/// <summary>The system's source as Revit declares it: base equipment, its base connector, and any connector Revit reports Out.</summary>
public sealed record MepSource(MepElementRef Equipment, int? BaseConnectorId, IReadOnlyList<int> OutConnectorIds, IReadOnlyList<MepPort> Connectors);
/// <summary>Domain is a field value ("piping", "duct"), never part of the contract's shape. Flow is Revit internal cubic feet per second.</summary>
public sealed record MepSystemRow(string UniqueId, long ElementId, string Name, string Domain,
    MepFact<MepElementRef> SystemType, string Classification, MepFact<double?> FlowCubicFeetPerSecond,
    MepFact<MepSource> Source);
/// <summary>A system member. Lengths and sizes are Revit internal feet; a size a domain does not have reads absent.</summary>
public sealed record MepMember(string UniqueId, long ElementId, string Name, string Kind,
    MepFact<double?> FlowCubicFeetPerSecond, MepFact<double?> NominalDiameterFt, MepFact<double?> InnerDiameterFt,
    MepFact<double?> WidthFt, MepFact<double?> HeightFt, MepFact<double?> LengthFt,
    MepFact<MepElementRef> Segment, MepFact<MepElementRef> Type, IReadOnlyList<MepPort> Connectors);
public sealed record MepSystemMembersRequest(string? SystemUniqueId = null, int MaxSystems = 256, int MaxElements = 4096);
public sealed record MepSystemMembersData(IReadOnlyList<MepSystemRow> Systems, string? SystemUniqueId,
    IReadOnlyList<MepMember> Elements);
public sealed record MepSegmentSizesRequest(int MaxSegments = 256, int MaxSizesPerSegment = 512);
public sealed record MepSizeRow(double NominalDiameterFt, double InnerDiameterFt, double OuterDiameterFt);
public sealed record MepSegmentRow(string UniqueId, long ElementId, string Name, string Domain, string Kind, IReadOnlyList<MepSizeRow> Sizes);
public sealed record MepSegmentSizesData(IReadOnlyList<MepSegmentRow> Segments);
