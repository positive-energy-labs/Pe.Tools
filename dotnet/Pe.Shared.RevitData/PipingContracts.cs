using Newtonsoft.Json;

namespace Pe.Shared.RevitData.Piping;

public enum PipingReadState { Value, Absent, Error }
public sealed record PipingFact<T>(PipingReadState State,
    [property: JsonProperty(Required = Required.AllowNull, NullValueHandling = NullValueHandling.Include)] T? Value,
    string? Error = null);
public sealed record PipingElementRef(string UniqueId, long ElementId, string Name);
public sealed record PipingPeer(string UniqueId, long ElementId, int ConnectorId);
public sealed record PipingPort(int ConnectorId, PipingFact<string> Direction, IReadOnlyList<PipingPeer> Peers);
public sealed record PipingSource(PipingElementRef Equipment, int? BaseConnectorId, IReadOnlyList<int> OutConnectorIds, IReadOnlyList<PipingPort> Connectors);
public sealed record PipingSystemRow(string UniqueId, long ElementId, string Name,
    PipingFact<PipingElementRef> SystemType, string Classification, PipingFact<double?> FlowCubicFeetPerSecond,
    PipingFact<PipingSource> Source);
public sealed record PipingMember(string UniqueId, long ElementId, string Name, string Kind,
    PipingFact<double?> FlowCubicFeetPerSecond, PipingFact<double?> NominalDiameterFt,
    PipingFact<double?> InnerDiameterFt, PipingFact<double?> LengthFt,
    PipingFact<PipingElementRef> Segment, PipingFact<PipingElementRef> PipeType, IReadOnlyList<PipingPort> Connectors);
public sealed record PipingSystemsRequest(string? SystemUniqueId = null, int MaxSystems = 256, int MaxElements = 4096);
public sealed record PipingSystemsData(IReadOnlyList<PipingSystemRow> Systems, string? SystemUniqueId,
    IReadOnlyList<PipingMember> Elements);
public sealed record PipeSizeCatalogRequest(int MaxSegments = 256, int MaxSizesPerSegment = 512);
public sealed record PipeSizeRow(double NominalDiameterFt, double InnerDiameterFt, double OuterDiameterFt);
public sealed record PipeSegmentRow(string UniqueId, long ElementId, string Name, IReadOnlyList<PipeSizeRow> Sizes);
public sealed record PipeSizeCatalogData(IReadOnlyList<PipeSegmentRow> Segments);
