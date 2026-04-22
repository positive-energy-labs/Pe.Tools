using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
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
[ExportTsEnum]
public enum ElectricalPanelCapacitySource {
    None,
    PanelScheduleData
}

[ExportTsInterface]
public record ElectricalPanelFilter {
    public List<string> PanelNames { get; init; } = [];
    public List<string> Marks { get; init; } = [];
}

[ExportTsInterface]
public record ElectricalCircuitFilter {
    public List<string> PanelNames { get; init; } = [];
    public List<string> CircuitNumbers { get; init; } = [];
    public List<string> LoadNames { get; init; } = [];
}

[ExportTsInterface]
public record ElectricalLoadClassificationFilter {
    public List<string> Names { get; init; } = [];
    public List<string> Abbreviations { get; init; } = [];
}

[ExportTsInterface]
public record ElectricalCircuitsCatalogOptions(
    RequestedParameterQuery? ParameterQuery = null,
    bool IncludeNearbyProxyContext = false,
    double NearbyRadiusFeet = 8.0,
    int MaxNearbyCandidatesPerElement = 4,
    int MaxNearbyCandidatesPerCircuit = 8
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalPanelsCatalogData(
    List<ElectricalPanelCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
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
[ExportTsEnum]
public enum ElectricalNearbyProxyCandidateMatchReason {
    NearbyIdentityCandidate,
    RequestedParameterIdentityMatch,
    MarkIdentityMatch
}

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalCircuitWireEntry(
    long WireId,
    string WireUniqueId,
    string? WireTypeName,
    string WiringType,
    int HotConductorCount,
    int NeutralConductorCount,
    int GroundConductorCount
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalCircuitsCatalogData(
    List<ElectricalCircuitCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record ElectricalDemandFactorDefinitionEntry(
    long DemandFactorId,
    string DemandFactorUniqueId,
    string Name,
    string RuleType,
    bool IncludeAdditionalLoad,
    string? AdditionalLoad,
    int ValuesCount
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElectricalLoadClassificationsCatalogData(
    List<ElectricalLoadClassificationCatalogEntry> Entries,
    List<RevitDataIssue> Issues
);