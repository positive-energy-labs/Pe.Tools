using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Protocol;
using Pe.Shared.HostContracts.SettingsStorage;
using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.HostContracts.RevitData;

[ExportTsInterface]
public record SelectionContextRequest(
    BridgeSessionSelector? Target = null
) : IBridgeSessionRequest;

[ExportTsInterface]
public record SelectionSystemRef(
    long SystemId,
    string SystemUniqueId,
    string SystemKind,
    string? Name,
    string? CircuitNumber,
    string? PanelName,
    string? LoadName
);

[ExportTsInterface]
public record SelectionElementRef(
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
public record SelectionConnectorSummary(
    int ConnectorCount,
    int ElectricalConnectorCount
);

[ExportTsInterface]
public record SelectionCircuitContext(
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
    List<SelectionElementRef> ConnectedElements
);

[ExportTsInterface]
public record SelectionPanelContext(
    long PanelId,
    string PanelUniqueId,
    string PanelName,
    string? FamilyName,
    string? TypeName,
    string? DistributionSystem,
    int AssignedCircuitCount
);

[ExportTsInterface]
public record SelectionWireContext(
    long WireId,
    string WireUniqueId,
    string? WireTypeName,
    string WiringType,
    int HotConductorNum,
    int NeutralConductorNum,
    int GroundConductorNum,
    List<SelectionSystemRef> Systems,
    List<SelectionElementRef> ConnectedOwners
);

[ExportTsInterface]
public record SelectionElectricalContext(
    ElectricalInsightRole Role,
    List<SelectionSystemRef> Systems,
    SelectionSystemRef? PrimarySystem,
    SelectionElementRef? BaseEquipment
);

[ExportTsInterface]
public record SelectionPanelScheduleContext(
    long ScheduleId,
    string ScheduleUniqueId,
    string ScheduleName,
    string? PanelName,
    string? TemplateName
);

[ExportTsInterface]
public record SelectionLoadClassificationContext(
    long ClassificationId,
    string ClassificationUniqueId,
    string Name,
    string? Abbreviation,
    string? DemandFactorName
);

[ExportTsInterface]
public record SelectionContextEntry(
    long ElementId,
    string ElementUniqueId,
    string ClassName,
    string? CategoryName,
    string Name,
    string? FamilyName,
    string? TypeName,
    string? Mark,
    string? TagInstance,
    string? LevelName,
    SelectionElectricalContext? Electrical,
    SelectionConnectorSummary? Connectors,
    SelectionCircuitContext? Circuit,
    SelectionPanelContext? PanelContext,
    SelectionWireContext? Wire,
    SelectionPanelScheduleContext? PanelSchedule,
    SelectionLoadClassificationContext? LoadClassification
);

[ExportTsInterface]
public record SelectionContextData(
    string DocumentTitle,
    bool IsFamilyDocument,
    int SelectionCount,
    List<SelectionContextEntry> Entries,
    List<RevitDataIssue> Issues
);

[ExportTsInterface]
public record SelectionContextEnvelopeResponse(
    bool Ok,
    EnvelopeCode Code,
    string Message,
    List<ValidationIssue> Issues,
    SelectionContextData? Data
) : IHostDataEnvelope<SelectionContextData> {
    public object? GetData() => this.Data;
}
