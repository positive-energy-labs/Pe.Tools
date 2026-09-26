using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using System.Runtime.Serialization;

namespace Pe.Shared.RevitData.Ducts;

/// <summary>Who supplied a solver assumption. Defaults describe a scenario, never measured equipment performance.</summary>
public enum AssumptionSource { User, Default }

/// <summary>A value plus its author or a cited reason for the default. Null means the value is still unknown.</summary>
public sealed record Assumption<T>(T Value, AssumptionSource Source, string Reason);

/// <summary>Installation condition of flex duct. Compressed and unknown installations need an explicit pressure multiplier.</summary>
public enum FlexCompression { FullyExtended, Compressed, Unknown }

/// <summary>A disconnected port is either sealed at zero flow, deliberately excluded at zero flow, or needs a physical connection.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum OpenEndVerdict {
    [EnumMember(Value = "capped")] Capped,
    [EnumMember(Value = "ignore")] Ignore,
    [EnumMember(Value = "connect")] Connect
}

/// <summary>The fitting leg, relative to the equipment root. Return/exhaust junctions converge in the opposite direction.</summary>
public enum FittingPath { Bend, Straight, Branch }

/// <summary>Portable fitting types recognized by the pressure solver. Other parts use the explicit fallback coefficient.</summary>
public enum PressurePartType { Other, Elbow, Tee, LateralTee, Transition, Union }

/// <summary>Construction class supported by captured evidence or an author; PartType alone cannot establish it.</summary>
[JsonConverter(typeof(StringEnumConverter))]
public enum FittingConstruction {
    [EnumMember(Value = "unknown")] Unknown,
    [EnumMember(Value = "smooth-round")] SmoothRound,
    [EnumMember(Value = "mitered")] Mitered,
    [EnumMember(Value = "vaned")] Vaned,
    [EnumMember(Value = "simple-junction")] SimpleJunction,
    [EnumMember(Value = "transition")] Transition
}

/// <summary>A fitting outlet in the root-to-terminal walk, or a disconnected physical connector.</summary>
public sealed record PressurePort(long ElementId, int Connector);

/// <summary>A captured or derived value and the exact evidence supporting it. Null values explicitly mean unknown.</summary>
public sealed record DuctEvidence<T>(T Value, DuctProvenance Provenance, string Evidence);

/// <summary>Area in square feet of one physical connector, keyed by its stable index within the part.</summary>
public sealed record FittingConnectorArea(int Connector, DuctEvidence<double?> AreaFt2);

/// <summary>Centerline r/D and construction evidence used to select a coefficient row; junctions also carry per-port areas.</summary>
public sealed record FittingGeometry(DuctEvidence<double?> AngleDegrees, DuctEvidence<double?> RadiusOverDiameter,
    DuctEvidence<FittingConstruction> Construction, IReadOnlyList<FittingConnectorArea> ConnectorAreas);

/// <summary>
/// Missing design inputs. Element component drops override family drops; explicit zero is allowed.
/// Component values must be losses at the design flow, external to the stated fan rating, to avoid counting an integral coil twice.
/// Fan and component defaults are unknown. Supply/return budgets need both groups on the same root.
/// </summary>
public sealed record Assumptions {
    internal const string Ashrae = "https://handbook.ashrae.org/Handbooks/F17/IP/f17_ch21/f17_ch21_ip.aspx";
    internal const string ManualD = "https://hvac-blog.acca.org/calculating-friction-rate-not-constant/";
    internal const string FlexStudy = "https://www.osti.gov/servlets/purl/836654";

    /// <summary>Air density in kg/m3; standard air is a scenario that can be replaced with the document's air settings.</summary>
    public Assumption<double> AirDensityKgPerM3 { get; init; } = new(1.204, AssumptionSource.Default, Ashrae + " standard air at 20 C");
    /// <summary>Dynamic viscosity in Pa.s.</summary>
    public Assumption<double> AirViscosityPaS { get; init; } = new(1.81e-5, AssumptionSource.Default, Ashrae + " standard air at 20 C");
    /// <summary>External static in inches of water at each root's design flow.</summary>
    public IReadOnlyDictionary<long, Assumption<double>> FanExternalStatic { get; init; } = new Dictionary<long, Assumption<double>>();
    /// <summary>External component losses in inches of water, keyed by element.</summary>
    public IReadOnlyDictionary<long, Assumption<double>> ComponentDropByElement { get; init; } = new Dictionary<long, Assumption<double>>();
    /// <summary>External component losses in inches of water, keyed by exact family name.</summary>
    public IReadOnlyDictionary<string, Assumption<double>> ComponentDropByFamily { get; init; } = new Dictionary<string, Assumption<double>>();
    /// <summary>Unknown fan performance remains unknown unless a user explicitly supplies a scenario default.</summary>
    public Assumption<double?> DefaultFanExternalStatic { get; init; } = new(null, AssumptionSource.Default, ManualD + " requires rated fan static; no generic fan rating exists");
    /// <summary>Unknown accessory and terminal losses remain unknown rather than silently becoming zero.</summary>
    public Assumption<double?> DefaultComponentDrop { get; init; } = new(null, AssumptionSource.Default, ManualD + " requires rated component losses at design flow");
    /// <summary>Fully extended fabric flex roughness, feet. 1 mm is the low end of ASHRAE's 1.0-4.6 mm range.</summary>
    public Assumption<double> FlexRoughnessFt { get; init; } = new(0.001 / 0.3048, AssumptionSource.Default, Ashrae + " Table 1 fabric flex, fully extended, low-end 1.0 mm scenario");
    /// <summary>Flex roughness overrides in feet, keyed by exact captured type name, matching the route's staged flex-roughness keys.</summary>
    public IReadOnlyDictionary<string, Assumption<double>> FlexRoughnessByType { get; init; } = new Dictionary<string, Assumption<double>>();
    /// <summary>The default explicitly assumes fully extended flex; the model spline does not establish installation compression.</summary>
    public Assumption<FlexCompression> FlexCompression { get; init; } = new(global::Pe.Shared.RevitData.Ducts.FlexCompression.FullyExtended, AssumptionSource.Default, FlexStudy + " fully extended baseline; installation is not captured");
    /// <summary>Measured or manufacturer correction relative to fully extended loss; required for other compression classes.</summary>
    public Assumption<double?> FlexPressureMultiplier { get; init; } = new(null, AssumptionSource.Default, FlexStudy + " compression correction depends on product and installation, no universal multiplier");
    /// <summary>Centerline geometry for a fitting, supplied by the author of a draft or from additional model facts.</summary>
    public IReadOnlyDictionary<long, Assumption<FittingGeometry>> FittingGeometry { get; init; } = new Dictionary<long, Assumption<FittingGeometry>>();
    /// <summary>Overrides referenced to the local outlet velocity pressure, keyed by fitting and root-to-terminal outlet.</summary>
    public IReadOnlyDictionary<PressurePort, Assumption<double>> FittingCoefficients { get; init; } = new Dictionary<PressurePort, Assumption<double>>();
    /// <summary>Screening fallback: one local velocity head. It is neither an ASHRAE row nor a conservative bound.</summary>
    public Assumption<double> UnmatchedFittingCoefficient { get; init; } = new(1, AssumptionSource.Default, Ashrae + " C multiplies velocity pressure; assume one head for unmatched geometry, not a rated coefficient or upper bound");
    /// <summary>Explicit judgments for disconnected connectors. Omitted connectors remain unresolved.</summary>
    public IReadOnlyDictionary<PressurePort, Assumption<OpenEndVerdict>> OpenEnds { get; init; } = new Dictionary<PressurePort, Assumption<OpenEndVerdict>>();
}

/// <summary>A materialized assumption dependency. Every result holds IDs into the solve's AssumptionsUsed list.</summary>
public sealed record UsedAssumption(string Id, string Value, AssumptionSource Source, string Reason);

/// <summary>A pressure-specific issue, separate from the unchanged ducts.snapshot issue taxonomy.</summary>
public sealed record PressureIssue(string Code, string GroupId, long? ElementId, string Reason);

/// <summary>Darcy-Weisbach results. Hydraulic diameter is 4A/P; velocity uses actual area, not equivalent round sizing diameter.</summary>
public sealed record DuctFriction(double VelocityFpm, double ReynoldsNumber, double FrictionFactor,
    double HydraulicDiameterFt, double VelocityPressureInWg, double FrictionInWgPer100Ft, double PressureDropInWg);

/// <summary>
/// One constant-flow interval of a segment. Tap positions are distances along the stored polyline, scaled to LengthFt.
/// Multiple intervals preserve flow changes at taps. Incomplete rows carry only the known subtree demand.
/// </summary>
public sealed record SegmentPressure(long SegmentId, string GroupId, double StartFt, double EndFt,
    double FlowCfm, DuctFriction Friction, bool IsComplete, IReadOnlyList<string> AssumptionsUsed);

/// <summary>A fitting's loss on one path, referenced to the named outlet velocity pressure. Junctions have separate leg results.</summary>
public sealed record FittingPressure(long FittingId, int OutletConnector, string GroupId, FittingPath Path,
    double FlowRatio, double AreaRatio, double Coefficient, double PressureDropInWg, double EquivalentLengthFt,
    string CoefficientRow, bool IsComplete, IReadOnlyList<string> AssumptionsUsed);

/// <summary>
/// A root-to-terminal path. DuctLossInWg includes ducts and fittings; component loss is separate for the static budget.
/// A null total means at least one component is unknown. IsComplete describes topology, demand, geometry and compression.
/// </summary>
public sealed record TerminalPressure(long TerminalId, long RootId, string GroupId, IReadOnlyList<long> Path,
    double DuctLossInWg, double? ComponentLossInWg, double? TotalLossInWg, double EffectiveLengthFt,
    bool IsComplete, IReadOnlyList<string> AssumptionsUsed);

/// <summary>
/// Group pressure assessment. CriticalPath is the highest total-loss path when component drops are known, otherwise
/// the highest known duct-loss path (CriticalPathIncludesComponents=false). PathEffectiveLengthFt is this group's
/// longest effective run, which can differ from its highest-loss run. TotalEffectiveLengthFt is the combined longest
/// supply plus return run, or the single exhaust run. Unpaired/ambiguous supply-return circuits have no full TEL or budget.
/// ASP subtracts the largest component loss on each side and the root's external components once. Margin uses the
/// highest combined total path loss; it does not add losses from parallel branches.
/// </summary>
public sealed record GroupPressure(string GroupId, bool IsWalkable, TerminalPressure? CriticalPath,
    bool CriticalPathIncludesComponents, double? PathEffectiveLengthFt, double? TotalEffectiveLengthFt,
    double? AvailableStaticInWg, double? FrictionRateInWgPer100Ft, double? MarginInWg,
    IReadOnlyList<string> AssumptionsUsed);

/// <summary>Complete solve receipt: local results, group budgets, issues, and the exact assumptions consumed.</summary>
public sealed record DuctPressureResult(IReadOnlyList<SegmentPressure> Segments, IReadOnlyList<FittingPressure> Fittings,
    IReadOnlyList<TerminalPressure> Terminals, IReadOnlyList<GroupPressure> Groups,
    IReadOnlyList<PressureIssue> Issues, IReadOnlyList<UsedAssumption> AssumptionsUsed) {
    /// <summary>The caller's staged Work revision used for this solve; null when no staged assumptions were supplied.</summary>
    public long? AssumptionRevision { get; init; }
}
