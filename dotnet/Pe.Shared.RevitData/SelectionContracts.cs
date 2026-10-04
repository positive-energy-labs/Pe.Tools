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

/// <summary>Request for revit.context.show-elements: select elements and zoom a view to them, for the person at the window.</summary>
/// <param name="ElementIds">Element ids to select and zoom to, from any handle-returning op.</param>
/// <param name="ViewId">Graphical view to activate and zoom; omit for the active view.</param>
public record RevitShowElementsRequest(
    List<long> ElementIds,
    long? ViewId = null
);

/// <summary>What revit.context.show-elements selected, what it could not find, and the view it zoomed.</summary>
/// <param name="Shown">Ids now selected.</param>
/// <param name="Missing">Requested ids with no element in this document.</param>
/// <param name="ViewId">The view that now shows them.</param>
/// <param name="ViewName">That view's name.</param>
/// <param name="Note">One line on what happened.</param>
public record RevitShowElementsData(
    List<long> Shown,
    List<long> Missing,
    long ViewId,
    string ViewName,
    string Note
);

/// <summary>Request for revit.context.lens: box a 3D view around elements so a window or a capture can look at them.</summary>
/// <param name="ElementIds">Model element ids to box, from any handle-returning op.</param>
/// <param name="Name">The 3D view's name; made when missing, refreshed when present. Default "Pe lens".</param>
/// <param name="PaddingFeet">Room around the elements' union box, in feet. Default 4.</param>
public record RevitLensRequest(
    List<long> ElementIds,
    string? Name = null,
    double? PaddingFeet = null
);

/// <summary>What revit.context.lens made or refreshed.</summary>
/// <param name="ViewId">The lens view's id, for revit.context.show-elements or revit.context.view-image.</param>
/// <param name="ViewName">That view's name.</param>
/// <param name="Created">True when the view was made by this call; false when an existing one was refreshed.</param>
/// <param name="Boxed">How many of the elements had geometry and sit inside the box.</param>
/// <param name="Note">One line on what happened.</param>
public record RevitLensData(
    long ViewId,
    string ViewName,
    bool Created,
    int Boxed,
    string Note
);
