using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Shared.RevitData;

public record ElementContextQueryRequest(
    ElementContextQuery? Query = null
);

public record ElementContextQuery(
    ElementContextQueryKind Kind = ElementContextQueryKind.CurrentSelection,
    List<long>? ElementIds = null,
    List<string>? ElementUniqueIds = null,
    RequestedParameterQuery? ParameterQuery = null
);

[JsonConverter(typeof(StringEnumConverter))]
public enum ElementContextQueryKind {
    CurrentSelection,
    ElementReferences
}

public record ElementContextSystemRef(
    long SystemId,
    string SystemUniqueId,
    string SystemKind,
    string? Name,
    string? CircuitNumber,
    string? PanelName,
    string? LoadName
);

public record ElementContextElementRef(
    long ElementId,
    string ElementUniqueId,
    string ClassName,
    string? CategoryName,
    string Name,
    string? FamilyName,
    string? TypeName,
    string? Mark
);

public record ElementContextConnectorSummary(
    int ConnectorCount,
    int ElectricalConnectorCount
);

public record ElementContextCircuitData(
    long CircuitId,
    string CircuitUniqueId,
    string CircuitNumber,
    string? LoadName,
    string? PanelName,
    string? Voltage,
    string? ApparentLoad,
    string? ApparentCurrent,
    string? Rating,
    string? Frame,
    List<ElementContextElementRef> ConnectedElements
);

public record ElementContextPanelData(
    long PanelId,
    string PanelUniqueId,
    string PanelName,
    string? FamilyName,
    string? TypeName,
    string? DistributionSystem,
    int AssignedCircuitCount
);

public record ElementContextWireData(
    long WireId,
    string WireUniqueId,
    string? WireTypeName,
    string WiringType,
    int HotConductorNum,
    int NeutralConductorNum,
    int GroundConductorNum,
    List<ElementContextSystemRef> Systems,
    List<ElementContextElementRef> ConnectedOwners
);

public record ElementContextElectricalData(
    ElectricalInsightRole Role,
    List<ElementContextSystemRef> Systems,
    ElementContextSystemRef? PrimarySystem,
    ElementContextElementRef? BaseEquipment
);

public record ElementContextPanelScheduleData(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? PanelName,
    string? TemplateName
);

public record ElementContextLoadClassificationData(
    long ClassificationId,
    string ClassificationUniqueId,
    string Name,
    string? Abbreviation,
    string? DemandFactorName
);

public record ElementContextEntry(
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
    List<RequestedElementParameterValue>? RequestedParameters,
    string? LevelName,
    ElementContextElectricalData? Electrical,
    ElementContextConnectorSummary? Connectors,
    ElementContextCircuitData? Circuit,
    ElementContextPanelData? PanelContext,
    ElementContextWireData? Wire,
    ElementContextPanelScheduleData? PanelSchedule,
    ElementContextLoadClassificationData? LoadClassification
);

public record ElementContextQueryData(
    string DocumentTitle,
    bool IsFamilyDocument,
    ElementContextQueryKind QueryKind,
    int RequestedElementCount,
    int ResolvedElementCount,
    List<ElementContextEntry> Entries,
    List<RevitDataIssue> Issues
);
