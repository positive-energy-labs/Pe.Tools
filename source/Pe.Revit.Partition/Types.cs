using Pe.Revit.Space;

namespace Pe.Revit.Partition;

/// <summary>The enclosure a solve may see. Solid and Mesh categories, and Curve2D layers.</summary>
public sealed record Enclosure(Filter Solids, Filter Ribbons) {
    /// <summary>
    ///     Native walls and the project-a IFC enclosure categories plus the DWG layers that draw
    ///     enclosure. The full DWG layer set over-partitions by the millwork width — on Main Level#09
    ///     millwork out-footprints walls 245 sqft to 185.
    /// </summary>
    public static readonly Enclosure Default = new(
        new Filter(
            [SourceKind.Host, SourceKind.RevitLink, SourceKind.IfcLink],
            ["Walls", "Generic Models", "Structural Framing", "Columns"],
            [PrimKind.Solid, PrimKind.Mesh]),
        new Filter(
            null, null,
            [PrimKind.Curve2D],
            ["A_WALL*", "A_DOOR*", "A_GLAZ*", "A_STAR*"]));
}

/// <summary>The nine. Everything else is a constant with a FOOTGUN naming the line that measured it.</summary>
public sealed record Knobs(
    double InkHalfWidthFt = 0.125,
    double CloseFt = 0.75,
    double FloorTolFt = 1.5,
    double MinHeadroomFt = 6.0,
    double MinRoomSqft = 30.0,
    double MinFeatureWidthFt = 2.5,
    double MinBoundarySupport = 0.35,
    double InkBackedAcceptMin = 0.5
) {
    public static readonly Knobs Default = new();
}

public enum Disposition { Accepted, Held, Void, Excluded }

/// <summary>One shared boundary between two rooms and how much raw ink backs it.</summary>
public sealed record SharedEdge(int Other, double LengthFt, double Support);

/// <summary>Architectural Room boundaries in host feet. All flat XY loops use even-odd semantics.</summary>
public sealed record RoomProposal(string SourceKey, string Name, string Number, double[][] Loops);

/// <summary>
///     Captured inputs to the one solver. ZoneLoops retains every boundary in host feet with
///     even-odd semantics. Resolved contains knee solids, knee ribbons, header solids, header ribbons.
/// </summary>
public sealed record PartitionInput(
    SliceAnswer Knee,
    SliceAnswer Header,
    double[][] ZoneLoops,
    double LevelZ,
    Knobs Knobs,
    IReadOnlyList<Resolved> Resolved,
    string EnclosureSource,
    IReadOnlyList<RoomProposal> Proposals,
    string? NoEnclosureDetail
);

/// <summary>One face of the partition. Loop is a closed CCW ring x0,y0,x1,y1,... in host feet.</summary>
public sealed record Room(
    int Index,
    Disposition Disposition,
    string? Reason,
    double[] Loop,
    double AreaSqft,
    double LabelX,
    double LabelY,
    double InkBacked,
    double? FloorZ,
    double? CeilingZ,
    IReadOnlyList<SharedEdge> Shared,
    IReadOnlyList<double[]>? Holes = null,
    RoomProposal? Proposal = null
);

/// <summary>accepted + held + void + excluded == zone within 1e-6 sf, or the verb throws.</summary>
public sealed record Accounting(double ZoneSqft, double Accepted, double Held, double Void, double Excluded);

/// <summary>
///     <see cref="Stamp" /> carries one resolved gate and the enclosure is two filters, so both are
///     echoed here (round 2 ruling). <see cref="EnclosureSource" /> says where the declaration came
///     from: the request, the per-document parameter, or the default and why.
/// </summary>
public sealed record PartitionAnswer(
    Stamp Stamp,
    Searched Searched,
    Knobs Knobs,
    IReadOnlyList<Room> Rooms,
    Accounting Accounting,
    string? Hold,
    IReadOnlyList<Resolved> Resolved,
    string EnclosureSource,
    double Ms
);

public sealed record PartitionRequest(
    long ZoneRegion,
    Enclosure? Enclosure = null,
    Knobs? Knobs = null
);

/// <summary>Thrown when the partition stops being a partition. These never Hold; they throw.</summary>
public sealed class PartitionException(string message) : Exception(message);

/// <summary>The closed reason set. The TSV disposition column already carries these strings.</summary>
public static class Reasons {
    public const string NoEnclosure = "no-enclosure";
    public const string Unbacked = "unbacked";
    public const string ZoneEdgeOnly = "zone-edge-only";
    public const string NoFloor = "no-floor";
    public const string NoCeiling = "no-ceiling";
    public const string LowHeadroom = "low-headroom";
    public const string TooSmall = "too-small";
    public const string TooNarrow = "too-narrow";
    public const string Wall = "wall";
}
