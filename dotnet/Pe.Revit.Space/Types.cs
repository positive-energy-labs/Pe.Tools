namespace Pe.Revit.Space;

/// <summary>
///     What a triangle came from. <see cref="Curve2D" /> is a DWG 2D layer raised into a vertical
///     ribbon; it is never an obstructor unless a filter names it.
/// </summary>
public enum PrimKind { Solid, Mesh, Curve2D }

/// <summary>Which document a partition reads. One partition per source.</summary>
public enum SourceKind { Host, RevitLink, IfcLink }

/// <summary>Architectural height authority, independent of collision geometry. None means unclassified.</summary>
[Flags]
public enum HeightRole { None = 0, Floor = 1, Overhead = 2 }

public enum ProbePurpose { Obstructions, RoomHeights }

/// <summary>
///     One triangle in host internal feet. 40 bytes.
///     ponytail: float vertices, so a stored coordinate quantizes to about 1.5e-4 ft at 1300 ft from
///     the origin. Widen to double only when a claim needs finer than 0.001 ft; that triples memory.
/// </summary>
public struct Tri {
    public Vector3 A, B, C;

    /// <summary>Index into the partition's <see cref="PrimRow" /> array. Nothing else is per triangle.</summary>
    public int Prim;

    /// <summary>
    ///     Zero area after float quantization. Ericson's closest-point routine divides by the
    ///     barycentric sum, which is exactly zero here, so a degenerate triangle in the soup is a
    ///     NaN waiting for the first sweep that touches it (palette, 2026-09-06). Dropped at ingest.
    /// </summary>
    public bool IsDegenerate => Vector3.Cross(this.B - this.A, this.C - this.A).LengthSquared() < 1e-12f;
}

/// <summary>
///     How far a 2D DWG layer was raised and why. A ribbon is an assumption wearing geometry, so the
///     assumption travels on the row and into the Handle. Heights are per polyline, so one row holds
///     the tallest band it emitted and the distinct reasons behind all of them.
/// </summary>
public sealed record Extrusion(double MaxHeightFt, IReadOnlyList<string> Reasons);

/// <summary>
///     One row per ingested element, except a DWG import, which owns one row per layer so a filter
///     can name a layer and a Handle can report one. <see cref="Layer" /> and
///     <see cref="Extrusion" /> are null on every Solid and Mesh row.
/// </summary>
public sealed record PrimRow(
    int Source,
    long ElementId,
    string UniqueId,
    string Category,
    PrimKind Kind,
    Aabb Box,
    int Triangles,
    string? Layer = null,
    Extrusion? Extrusion = null,
    HeightRole HeightRole = HeightRole.None
);

/// <summary>One row per partition. Carried inside every <see cref="Stamp" />.</summary>
public sealed record SourceRow(
    int Source,
    string DocumentKey,
    long? LinkInstanceId,
    SourceKind Kind,
    long BuiltAtEpoch,
    bool Dirty,
    int Elements,
    int Triangles,
    int Skipped
);

/// <summary>Axis-aligned bounds in host internal feet.</summary>
public readonly record struct Aabb(
    double MinX,
    double MinY,
    double MinZ,
    double MaxX,
    double MaxY,
    double MaxZ
) {
    public static readonly Aabb Empty = new(
        double.MaxValue, double.MaxValue, double.MaxValue,
        double.MinValue, double.MinValue, double.MinValue);

    public Aabb Include(Vector3 p) => new(
        Math.Min(this.MinX, p.X), Math.Min(this.MinY, p.Y), Math.Min(this.MinZ, p.Z),
        Math.Max(this.MaxX, p.X), Math.Max(this.MaxY, p.Y), Math.Max(this.MaxZ, p.Z));

    public Aabb Expand(double d) => new(
        this.MinX - d, this.MinY - d, this.MinZ - d,
        this.MaxX + d, this.MaxY + d, this.MaxZ + d);

    public bool Overlaps(Aabb o) =>
        this.MinX <= o.MaxX && this.MaxX >= o.MinX
        && this.MinY <= o.MaxY && this.MaxY >= o.MinY
        && this.MinZ <= o.MaxZ && this.MaxZ >= o.MinZ;
}

/// <summary>The address of one element. Enough for the host to select it.</summary>
public sealed record Handle(
    string DocumentKey,
    long ElementId,
    string UniqueId,
    long? LinkInstanceId,
    string Category,
    PrimKind Kind,
    string? Layer = null,
    Extrusion? Extrusion = null,
    HeightRole HeightRole = HeightRole.None
);

/// <summary>
///     The options a verb actually ran with, after defaults were applied. Never null and never a
///     silence: a caller who passed no filter reads back <c>Kinds: [Solid, Mesh]</c> and the sources
///     and categories spelled out. This is the gate that was in force, not the outcome; what the
///     verb then had to touch is <see cref="Searched" />.
/// </summary>
public sealed record Resolved(
    IReadOnlyList<SourceKind> Sources,
    IReadOnlyList<string> Categories,
    IReadOnlyList<PrimKind> Kinds,
    IReadOnlyList<string> Layers,
    IReadOnlyList<long> ExcludedElementIds
);

/// <summary>Provenance and freshness. Every answer embeds one; it is not optional.</summary>
public sealed record Stamp(
    string HostDocumentKey,
    long Epoch,
    string Frame,
    DateTime BuiltUtc,
    IReadOnlyList<SourceRow> Sources,
    bool Fresh,
    Resolved Resolved
) {
    /// <summary>The only frame this library speaks. A reader that sees another value must refuse.</summary>
    public const string HostInternalFt = "host-internal-ft";
}

/// <summary>What a verb is allowed to look at. Null means no restriction on that axis.</summary>
public sealed record Filter(
    IReadOnlyList<SourceKind>? Sources = null,
    IReadOnlyList<string>? Categories = null,
    IReadOnlyList<PrimKind>? Kinds = null,
    IReadOnlyList<string>? Layers = null,
    IReadOnlyList<long>? ExcludeElementIds = null
) {
    public static readonly Filter Default = new();

    public bool Wants(SourceKind kind) => this.Sources is null || this.Sources.Contains(kind);

    /// <summary>
    ///     A null Kinds means the two obstructing kinds, never Curve2D: a DWG ribbon has to be asked
    ///     for by name. A set Layers means only rows carrying a matching layer, which excludes every
    ///     Solid and Mesh row by construction. ExcludeElementIds drops named elements outright, which
    ///     is the only way to ask "everything except me": a duct swept along its own centerline
    ///     otherwise reports itself, and dropping its whole category drops every other duct too.
    ///     ponytail: linear scan of the exclusion list per row. It holds one duct and its fittings,
    ///     not a thousand; make it a HashSet when someone excludes a whole system.
    /// </summary>
    public bool Wants(PrimRow row) =>
        (this.Kinds is null ? row.Kind is PrimKind.Solid or PrimKind.Mesh : this.Kinds.Contains(row.Kind))
        && (this.Categories is null || this.Categories.Contains(row.Category, StringComparer.OrdinalIgnoreCase))
        && (this.Layers is null || Matches(row.Layer, this.Layers))
        && (this.ExcludeElementIds is null || !this.ExcludeElementIds.Contains(row.ElementId));

    /// <summary>Exact name or a trailing-star prefix, case insensitive. No other wildcard.</summary>
    private static bool Matches(string? layer, IReadOnlyList<string> patterns) {
        if (layer is null) return false;
        foreach (var p in patterns) {
            if (p.Length > 0 && p[^1] == '*') {
                if (layer.StartsWith(p[..^1], StringComparison.OrdinalIgnoreCase)) return true;
            } else if (string.Equals(layer, p, StringComparison.OrdinalIgnoreCase)) {
                return true;
            }
        }

        return false;
    }
}

/// <summary>How much of the world the verb had to touch to answer. The honesty counter.</summary>
public sealed record Searched(
    int Docs,
    int Categories,
    int Candidates,
    int Examined,
    int Skipped
);

/// <summary>One original CAD curve in host internal feet, before ribbon extrusion.</summary>
public sealed record OriginalCurve(
    Handle Handle,
    IReadOnlyList<int> TraversalPath,
    string Layer,
    string Kind,
    IReadOnlyList<double[]> Points,
    OriginalArc? Arc = null
);

/// <summary>Native arc pose required to reconstruct the captured curve.</summary>
public sealed record OriginalArc(
    double[] Center,
    double Radius,
    bool IsBound,
    double[]? Start,
    double[]? End,
    double[] BasisX,
    double[] BasisY,
    double[] Normal,
    double? StartParameter,
    double? EndParameter
);

/// <summary>A geometry-read failure. Path is the ordinal path reached before the failure.</summary>
public sealed record CurveCaptureFailure(
    IReadOnlyList<int> TraversalPath,
    string Stage,
    string Detail,
    Handle? Handle = null
);
