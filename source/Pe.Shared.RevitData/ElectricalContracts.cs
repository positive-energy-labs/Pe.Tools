using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.Codegen;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalInsightRole {
    Panel,
    DownstreamPanel,
    LoadFamilyInstance,
    ProxyFixture,
    InlineElectricalEquipment,
    Circuit,
    Wire,
    LoadClassification,
    Element
}

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalPanelCapacitySource {
    None,
    PanelScheduleData
}

[ExportTsSchema]
public record ElectricalPanelsCatalogRequest(
    ElectricalPanelFilter? Filter
);

[ExportTsSchema]
public record ElectricalCircuitsCatalogRequest(
    ElectricalCircuitFilter? Filter,
    ElectricalCircuitsCatalogOptions? Options = null
);

[ExportTsSchema]
public record ElectricalLoadClassificationsCatalogRequest(
    ElectricalLoadClassificationFilter? Filter
);

[ExportTsSchema]
public record ElectricalPanelFilter {
    public List<string> PanelNames { get; init; } = [];
    public List<string> Marks { get; init; } = [];
}

[ExportTsSchema]
public record ElectricalCircuitFilter {
    public List<string> PanelNames { get; init; } = [];
    public List<string> CircuitNumbers { get; init; } = [];
    public List<string> LoadNames { get; init; } = [];
}

[ExportTsSchema]
public record ElectricalLoadClassificationFilter {
    public List<string> Names { get; init; } = [];
    public List<string> Abbreviations { get; init; } = [];
}

[ExportTsSchema]
public record ElectricalCircuitsCatalogOptions(
    RequestedParameterQuery? ParameterQuery = null,
    bool IncludeNearbyProxyContext = false,
    double NearbyRadiusFeet = 8.0,
    int MaxNearbyCandidatesPerElement = 4,
    int MaxNearbyCandidatesPerCircuit = 8
);

[ExportTsSchema]
public record ElectricalCatalogFilterReport(
    List<string> AppliedPanelNames,
    List<string> AppliedCircuitNumbers,
    List<string> AppliedLoadNames,
    List<string> AppliedMarks,
    List<string> IgnoredBlankFilterValues,
    int CandidateCountBeforeFilter,
    int MatchedCount
);

[ExportTsSchema]
public record ElectricalPanelCatalogEntry(
    long PanelId,
    string PanelUniqueId,
    string PanelName,
    string? Mark,
    string? CategoryName,
    string? FamilyName,
    string? TypeName,
    ElectricalInsightRole Role,
    bool IsOperationalPanel,
    string? DistributionSystemName,
    int MaxCircuitCount,
    int? ConfiguredSlotCount,
    int OccupiedSlotCount,
    int? AvailableSlotCount,
    ElectricalPanelCapacitySource CapacitySource,
    int AssignedCircuitCount,
    int PanelScheduleCount,
    int ConnectedLoadCount
);

[ExportTsSchema]
public record ElectricalPanelsCatalogData(
    List<ElectricalPanelCatalogEntry> Entries,
    List<RevitDataIssue> Issues,
    ElectricalCatalogFilterReport? FilterReport = null
);

[ExportTsSchema]
public record ElectricalCircuitConnectedElementEntry(
    long ElementId,
    string ElementUniqueId,
    string ClassName,
    string? CategoryName,
    string Name,
    string? FamilyName,
    string? TypeName,
    string? Mark,
    string? EffectiveIdentity,
    ElementIdentitySource EffectiveIdentitySource,
    ElectricalInsightRole Role,
    bool HasElectricalConnector,
    int ElectricalSystemCount,
    List<RequestedElementParameterValue>? RequestedParameters
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsSchema]
public enum ElectricalNearbyProxyCandidateMatchReason {
    NearbyIdentityCandidate,
    RequestedParameterIdentityMatch,
    MarkIdentityMatch
}

[ExportTsSchema]
public record ElectricalNearbyProxyCandidateEntry(
    long ElementId,
    string ElementUniqueId,
    string ClassName,
    string? CategoryName,
    string Name,
    string? FamilyName,
    string? TypeName,
    string? Mark,
    string? EffectiveIdentity,
    ElementIdentitySource EffectiveIdentitySource,
    ElectricalInsightRole Role,
    double DistanceFeet,
    ElectricalNearbyProxyCandidateMatchReason MatchReason,
    List<RequestedElementParameterValue>? RequestedParameters
);

[ExportTsSchema]
public record ElectricalCircuitWireEntry(
    long WireId,
    string WireUniqueId,
    string? WireTypeName,
    string WiringType,
    int HotConductorCount,
    int NeutralConductorCount,
    int GroundConductorCount
);

[ExportTsSchema]
public record ElectricalCircuitCatalogEntry(
    long CircuitId,
    string CircuitUniqueId,
    string CircuitNumber,
    string? LoadName,
    long? PanelId,
    string? PanelUniqueId,
    string? PanelName,
    string? SlotIndex,
    string? Ways,
    int PolesNumber,
    string? Voltage,
    string? ApparentLoad,
    string? ApparentCurrent,
    string? TrueLoad,
    string? TrueCurrent,
    string? Rating,
    string? Frame,
    bool RatingOverride,
    string? RatingOverrideValueDisplay,
    string? WireSize,
    string? WireTypeName,
    bool IsEmpty,
    bool IsMultipleNetwork,
    bool HasCustomCircuitPath,
    bool HasPathOffset,
    bool HasProxyLikeConnectedElements,
    int ProxyLikeConnectedElementCount,
    bool ProxyInferenceRecommended,
    ElectricalInsightRole? PrimaryConnectedRole,
    List<ElectricalInsightRole> ConnectedRoles,
    List<ElectricalCircuitConnectedElementEntry> ConnectedElements,
    List<ElectricalCircuitWireEntry> Wires,
    List<ElectricalNearbyProxyCandidateEntry>? NearbyProxyCandidates
);

[ExportTsSchema]
public record ElectricalCircuitsCatalogData(
    List<ElectricalCircuitCatalogEntry> Entries,
    List<RevitDataIssue> Issues,
    ElectricalCatalogFilterReport? FilterReport = null
);

[ExportTsSchema]
public record ElectricalDemandFactorDefinitionEntry(
    long DemandFactorId,
    string DemandFactorUniqueId,
    string Name,
    string RuleType,
    bool IncludeAdditionalLoad,
    string? AdditionalLoad,
    int ValuesCount
);

[ExportTsSchema]
public record ElectricalLoadClassificationCatalogEntry(
    long ClassificationId,
    string ClassificationUniqueId,
    string Name,
    string? Abbreviation,
    bool Motor,
    bool Other,
    string? SpaceLoadClass,
    ElectricalDemandFactorDefinitionEntry? DemandFactor
);

[ExportTsSchema]
public record ElectricalLoadClassificationsCatalogData(
    List<ElectricalLoadClassificationCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);
