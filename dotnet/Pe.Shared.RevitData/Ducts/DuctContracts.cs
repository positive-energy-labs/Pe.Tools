using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Runtime.Serialization;

namespace Pe.Shared.RevitData.Ducts;

// The `ducts.snapshot` contract: one read-only census of every duct network in one project document.
// Units are converted at the collector: feet, inches, CFM, fpm, in-wg. Points are [x, y, z] model feet.
// Facts and issues come from here; readiness under a person's assumptions is derived by the web route.

/// <summary>Where a value came from. The route prints it beside the value.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum DuctProvenance {
    /// <summary>Read from element geometry or connector topology.</summary>
    [EnumMember(Value = "geometry")] Geometry,
    /// <summary>A value Revit computed or stores (duct Flow, Velocity, Pressure Drop).</summary>
    [EnumMember(Value = "revit-reported")] RevitReported,
    /// <summary>A value Revit ships as its default and nobody changed (roughness 0.0003 ft).</summary>
    [EnumMember(Value = "revit-default")] RevitDefault,
    /// <summary>A value a designer typed (terminal design flow, fan static).</summary>
    [EnumMember(Value = "designer-stated")] DesignerStated,
    /// <summary>Computed by this census from other facts (pass-1 flow).</summary>
    [EnumMember(Value = "derived")] Derived
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctNodeKind {
    [EnumMember(Value = "equipment")] Equipment,
    [EnumMember(Value = "terminal")] Terminal,
    [EnumMember(Value = "fitting")] Fitting,
    [EnumMember(Value = "accessory")] Accessory,
    [EnumMember(Value = "cap")] Cap
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctSegmentKind {
    [EnumMember(Value = "duct")] Duct,
    [EnumMember(Value = "flex")] Flex
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctShape {
    [EnumMember(Value = "round")] Round,
    [EnumMember(Value = "rectangular")] Rectangular,
    [EnumMember(Value = "oval")] Oval,
    [EnumMember(Value = "other")] Other
}

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctIssueKind {
    /// <summary>A physical connector on a duct, fitting, accessory or terminal with nothing attached. Caps are not open ends.</summary>
    [EnumMember(Value = "open-end")] OpenEnd,
    /// <summary>The group's graph has a cycle; the element closes one.</summary>
    [EnumMember(Value = "loop")] Loop,
    /// <summary>A duct shorter than 3 in: a connector stub between fittings.</summary>
    [EnumMember(Value = "stub")] Stub,
    /// <summary>The group carries more than one system classification.</summary>
    [EnumMember(Value = "mixed-classification")] MixedClassification,
    /// <summary>Round under 3 in or over 36 in; rectangular side under 2.5 in or aspect over 8.</summary>
    [EnumMember(Value = "implausible-size")] ImplausibleSize,
    /// <summary>A flex duct whose type roughness is the Revit default, which is the rigid galvanized value.</summary>
    [EnumMember(Value = "default-flex-roughness")] DefaultFlexRoughness,
    /// <summary>Root equipment with no external static pressure stated.</summary>
    [EnumMember(Value = "no-fan-static")] NoFanStatic,
    /// <summary>An accessory in the path with no pressure drop stated.</summary>
    [EnumMember(Value = "no-component-drop")] NoComponentDrop,
    /// <summary>A terminal with no design flow.</summary>
    [EnumMember(Value = "no-terminal-flow")] NoTerminalFlow,
    /// <summary>A group with terminals and no equipment port.</summary>
    [EnumMember(Value = "no-root")] NoRoot,
    /// <summary>A group attached to more than one equipment port.</summary>
    [EnumMember(Value = "multi-root")] MultiRoot,
    /// <summary>A segment whose Revit-reported velocity is 2000 fpm or more.</summary>
    [EnumMember(Value = "high-velocity")] HighVelocity,
    /// <summary>A tee, tap, wye or cross with a leg carrying no pass-1 flow: Revit's table route charges that leg 0 and the branch grid has no point there.</summary>
    [EnumMember(Value = "no-flow-leg")] NoFlowLeg
}

/// <summary>Optional: which parameters carry the designer-stated values. Absent reads the defaults.</summary>
public sealed record DuctSnapshotRequest(DuctParameterSlots? Slots = null);

/// <summary>
///     Parameter names the census reads, instance first and then type. FanStatic (in-wg) and FanFlow (CFM) on HVAC
///     equipment, ComponentDrop (in-wg) on accessories, TerminalDrop (in-wg) on terminals as a catalog drop,
///     FittingCoefficient (a number) on fittings: the family's own loss coefficient, which the Pe loss server reads
///     live (the configurable door, kaitpw 2026-10-08).
/// </summary>
public sealed record DuctParameterSlots(
    string FanStatic = "PE_M_Fan_ExternalStaticPressure",
    string FanFlow = "PE_M_Fan_AirFlow",
    string ComponentDrop = "Pressure Drop",
    string? TerminalDrop = null,
    string FittingCoefficient = DuctParameterSlots.DefaultFittingCoefficient) {
    public const string DefaultFittingCoefficient = "Pe_C";
    private static readonly DuctParameterSlots Defaults = new();

    /// <summary>Each name this leaves blank (a partial wire object) comes from <paramref name="under" />.</summary>
    public DuctParameterSlots Over(DuctParameterSlots? under) => under is null
        ? this
        : new DuctParameterSlots(
            string.IsNullOrWhiteSpace(this.FanStatic) ? under.FanStatic : this.FanStatic,
            string.IsNullOrWhiteSpace(this.FanFlow) ? under.FanFlow : this.FanFlow,
            string.IsNullOrWhiteSpace(this.ComponentDrop) ? under.ComponentDrop : this.ComponentDrop,
            string.IsNullOrWhiteSpace(this.TerminalDrop) ? under.TerminalDrop : this.TerminalDrop,
            string.IsNullOrWhiteSpace(this.FittingCoefficient) ? under.FittingCoefficient : this.FittingCoefficient);

    /// <summary>A partial slots object from the wire deserializes missing names as null, not the defaults; this restores them.</summary>
    public DuctParameterSlots WithDefaults() => new(
        string.IsNullOrWhiteSpace(this.FanStatic) ? Defaults.FanStatic : this.FanStatic,
        string.IsNullOrWhiteSpace(this.FanFlow) ? Defaults.FanFlow : this.FanFlow,
        string.IsNullOrWhiteSpace(this.ComponentDrop) ? Defaults.ComponentDrop : this.ComponentDrop,
        string.IsNullOrWhiteSpace(this.TerminalDrop) ? null : this.TerminalDrop,
        string.IsNullOrWhiteSpace(this.FittingCoefficient) ? Defaults.FittingCoefficient : this.FittingCoefficient);
}

/// <summary>
///     Store is Pe's `_PE_DuctLosses` provenance blob, absent when the model has none. StoreError is set instead when
///     the blob is unreadable or another version (fail-closed: ducts.apply refuses to overwrite it).
/// </summary>
public sealed record DuctSnapshotData(
    DuctDocument Document,
    IReadOnlyList<DuctLevel> Levels,
    IReadOnlyList<DuctGroup> Groups,
    IReadOnlyList<DuctNode> Nodes,
    IReadOnlyList<DuctSegment> Segments,
    IReadOnlyList<DuctFlow> Flows,
    IReadOnlyList<DuctIssue> Issues,
    IReadOnlyList<DuctLayer> Layers,
    IReadOnlyList<DuctSystem> Systems,
    DuctParameterSlots Slots,
    DuctLossStore? Store = null,
    string? StoreError = null);

/// <summary>
///     The document read, when, and how long the read took. NetworkBasedCalculations is DuctSettings' engine switch:
///     read only: the snapshot guards an access violation on it, and apply never sets it (pressure-drop ledger).
/// </summary>
public sealed record DuctDocument(string Title, DateTimeOffset ReadAt, long ElapsedMs, bool NetworkBasedCalculations);

/// <summary>
///     One supply, return or exhaust MechanicalSystem as Revit reports it: the check beside Pe's own solve.
///     CriticalPath is GetCriticalPathSectionNumbers(); empty when Revit found none.
/// </summary>
public sealed record DuctSystem(
    long Id,
    string Name,
    string Classification,
    bool? IsWellConnected,
    long? BaseEquipmentId,
    int? BaseEquipmentConnector,
    double? CriticalPathLossInWg,
    IReadOnlyList<int> CriticalPath,
    IReadOnlyList<DuctSection> Sections);

/// <summary>One MEPSection: Revit's run of elements carrying one flow.</summary>
public sealed record DuctSection(int Number, double? FlowCfm, double? TotalPressureLossInWg, IReadOnlyList<long> ElementIds);

[JsonConverter(typeof(StringEnumConverter))]
public enum DuctLossMethod {
    [EnumMember(Value = "not-defined")] NotDefined,
    /// <summary>Revit's "Coefficient from ASHRAE Table": read only; it keeps a stale per-leg slot across method switches, so Pe never writes it (pressure-drop ledger 2026-10-08, 2026-10-12).</summary>
    [EnumMember(Value = "ashrae-table")] AshraeTable,
    [EnumMember(Value = "specific-coefficient")] SpecificCoefficient,
    [EnumMember(Value = "specific-loss")] SpecificLoss,
    /// <summary>Pe's own loss server: the family's coefficient parameter (the FittingCoefficient slot) when it has one, else each leg priced live from the rule's ASHRAE table.</summary>
    [EnumMember(Value = "pe-server")] PeServer,
    /// <summary>A server this census does not know, or no server parameter.</summary>
    [EnumMember(Value = "other")] Other
}

/// <summary>
///     A fitting's or accessory's loss state: the server in RBS_DUCT_FITTING_LOSS_METHOD_SERVER_PARAM and the string
///     fields of that server's entity on the instance, verbatim in Fields. Table, Coefficient and SpecificLossInWg are
///     read from them. RevitPressureDropInWg is the element's own RBS_DUCT_PRESSURE_DROP (RBS_PRESSURE_DROP is empty under a stored ASHRAE table).
/// </summary>
public sealed record DuctLoss(
    DuctLossMethod Method,
    string? ServerId,
    string? Table,
    double? Coefficient,
    double? SpecificLossInWg,
    double? RevitPressureDropInWg,
    IReadOnlyDictionary<string, string> Fields);

/// <summary>
///     A terminal's drop. AssignedPressureDropInWg is the first HVAC connector's AssignedPressureDrop; ConnectorLossMethod
///     its AssignedDuctLossMethod (NotDefined, Coefficient, SpecificLoss). Writable is true only for SpecificLoss, and
///     is necessary, not sufficient: Revit refuses the connector setter on a family's Specific Loss connector too (W3), so
///     ducts.apply writes the instance parameter the family binds to it, named by the TerminalDrop slot.
///     CatalogDropInWg is the TerminalDrop slot, if one is named.
/// </summary>
public sealed record DuctTerminalDrop(
    double? AssignedPressureDropInWg,
    string? ConnectorLossMethod,
    bool Writable,
    double? CatalogDropInWg);

/// <summary>A level; ElevationFt is Level.ProjectElevation (geometry frame), never Level.Elevation.</summary>
public sealed record DuctLevel(long Id, string Name, double ElevationFt);

/// <summary>
///     A connected duct network with equipment cut out: the unit a solver runs on. Id is "g" plus the smallest
///     element id in it, stable while that element exists. RootIds are the equipment it hangs off.
/// </summary>
public sealed record DuctGroup(
    string Id,
    IReadOnlyList<long> RootIds,
    IReadOnlyList<string> Classifications,
    IReadOnlyList<string> SystemNames,
    int TerminalCount,
    int ElementCount,
    int Loops,
    IReadOnlyList<string> IssueIds);

/// <summary>What a connector touches: an element id and that element's connector index.</summary>
public sealed record DuctRef(long ElementId, int Connector);

/// <summary>
///     One physical HVAC connector. Kind is "end" or "curve" (a tap on a duct's side). Direction is Revit's
///     (in, out, bidirectional); flow direction for the solver comes from the root, never from this.
///     FlowCfm is Revit's connector flow, read only on the legacy engine: under network-based calculations the getter can
///     crash Revit 2025 (pressure-drop ledger, W3).
/// </summary>
public sealed record DuctConnector(
    int Index,
    string Kind,
    double[] Point,
    DuctShape Shape,
    string Size,
    double? DiameterIn,
    double? WidthIn,
    double? HeightIn,
    double? FlowCfm,
    string Direction,
    string? Classification,
    DuctRef? ConnectedTo,
    double? AreaFt2 = null);

/// <summary>One stated or reported value with its unit and provenance.</summary>
public sealed record DuctFact(string Key, double? Value, string? Text, string Unit, DuctProvenance Provenance);

public sealed record DuctNode(
    long Id,
    DuctNodeKind Kind,
    string Category,
    string? Family,
    string? Type,
    string? PartType,
    long? LevelId,
    double[] Point,
    string? GroupId,
    string? SystemName,
    string? Classification,
    IReadOnlyList<DuctConnector> Connectors,
    IReadOnlyList<DuctFact> Facts,
    DuctLoss? Loss = null,
    DuctTerminalDrop? TerminalDrop = null,
    string? UniqueId = null);

public sealed record DuctRoughness(double ValueFt, DuctProvenance Provenance);

/// <summary>What Revit reports on the segment. Partial in most models; a check, never an input.</summary>
public sealed record DuctRevitValues(
    double? FlowCfm,
    double? VelocityFpm,
    double? FrictionInWgPer100Ft,
    double? PressureDropInWg);

public sealed record DuctSegment(
    long Id,
    DuctSegmentKind Kind,
    string? Type,
    DuctShape Shape,
    string Size,
    double? DiameterIn,
    double? WidthIn,
    double? HeightIn,
    double LengthFt,
    IReadOnlyList<double[]> Polyline,
    long? LevelId,
    string? GroupId,
    string? SystemName,
    string? Classification,
    DuctRoughness Roughness,
    DuctRevitValues Revit,
    IReadOnlyList<DuctConnector> Connectors,
    string? UniqueId = null);

/// <summary>Pass-1 flow: terminal design flow summed up the tree from the single root. At a tapped duct it is the upstream-end flow.</summary>
public sealed record DuctFlow(long SegmentId, double Cfm, DuctProvenance Provenance);

/// <summary>Id is "kind:elementId" (open ends add ":connector"); an assumption verdict keys on it.</summary>
public sealed record DuctIssue(
    string Id,
    DuctIssueKind Kind,
    long? ElementId,
    double[]? Point,
    string GroupId,
    string Note);

public sealed record DuctCoverage(int Have, int Of);

/// <summary>One real query, printed verbatim in Query, and how much of the model it answered.</summary>
public sealed record DuctLayer(string Key, string Title, string Query, DuctCoverage Coverage, DuctProvenance Provenance);
