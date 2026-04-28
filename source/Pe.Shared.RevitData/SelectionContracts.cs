using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.RevitData;

[ExportTsInterface]
public record ElementContextQueryRequest(
    ElementContextQuery? Query = null
);

[ExportTsInterface]
public record ElementContextQuery(
    ElementContextQueryKind Kind = ElementContextQueryKind.CurrentSelection,
    List<long>? ElementIds = null,
    List<string>? ElementUniqueIds = null,
    RequestedParameterQuery? ParameterQuery = null
);

[JsonConverter(typeof(StringEnumConverter))]
[ExportTsEnum]
public enum ElementContextQueryKind {
    CurrentSelection,
    ElementReferences
}

[ExportTsInterface]
public record ElementContextSystemRef(
    long SystemId,
    string SystemUniqueId,
    string SystemKind,
    string? Name,
    string? CircuitNumber,
    string? PanelName,
    string? LoadName
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElementContextConnectorSummary(
    int ConnectorCount,
    int ElectricalConnectorCount
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElementContextPanelData(
    long PanelId,
    string PanelUniqueId,
    string PanelName,
    string? FamilyName,
    string? TypeName,
    string? DistributionSystem,
    int AssignedCircuitCount
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElementContextElectricalData(
    ElectricalInsightRole Role,
    List<ElementContextSystemRef> Systems,
    ElementContextSystemRef? PrimarySystem,
    ElementContextElementRef? BaseEquipment
);

[ExportTsInterface]
public record ElementContextPanelScheduleData(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? PanelName,
    string? TemplateName
);

[ExportTsInterface]
public record ElementContextLoadClassificationData(
    long ClassificationId,
    string ClassificationUniqueId,
    string Name,
    string? Abbreviation,
    string? DemandFactorName
);

[ExportTsInterface]
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

[ExportTsInterface]
public record ElementContextQueryData(
    string DocumentTitle,
    bool IsFamilyDocument,
    ElementContextQueryKind QueryKind,
    int RequestedElementCount,
    int ResolvedElementCount,
    List<ElementContextEntry> Entries,
    List<RevitDataIssue> Issues
);
