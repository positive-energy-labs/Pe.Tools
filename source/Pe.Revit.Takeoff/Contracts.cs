namespace Pe.Revit.Takeoff;

// Room-takeoff contracts: the per-room payload the RHVAC / OpenStudio exporter consumes (sqft,
// perimeter, wall segments, interior label point, polygon, mean ceiling height). Detection must
// not depend on native Room names — architects place Rooms in only ~1/4-1/3 of spaces, so names
// are matched on later by containment. See docs/features/takeoffs/rhvac-and-mj-reference.md.

// Partition seed source (one seed = one candidate space before merges/dissolution):
// RegionCores = connected components of unobstructed domain; Hybrid = cores, except a core with
// >= 2 distance-transform plateaus is seeded by them so open-plan cores split along interior
// evidence ridges (ceiling/floor steps). DistanceMaxima is standalone plateau seeding: falsified as
// a default (under-seeds closets/baths, 41.9 vs 52.8 — see docs/features/takeoffs/LEDGER.md),
// retained last in the enum
// as the A/B control that makes Hybrid's contribution measurable rather than assumed.
public enum TakeoffSeedSource { RegionCores, Hybrid, DistanceMaxima }
public enum TakeoffSource { Detector, Native }
public enum ResidueReason { Border, Crumb, Rejected, Excluded, Held, Void }

// ADR 0011: the raster is gone and 43 of the 80 knobs went with it — every one existed to repair
// damage the renderer did. What survives is the nine SHAPE.md knobs, which are physical or law, plus
// the two the materializer owns. The solver's own defaults live on Pe.Revit.Partition.Knobs; these
// are the takeoff-side mirror the materializer and the RHVAC path still read.
public sealed class TakeoffOptions {
    public double InkHalfWidthFt = 0.125;   // physical: the drawn line weight of a band slice
    public double CloseFt = 0.75;           // physical: seals a 16 in stud gap, never a 3 ft doorway
    public double FloorTolFt = 1.5;         // law: which floor plane belongs to this level
    public double MinHeadroomFt = 6.0;      // law: walkable headroom, kills eaves
    public double MinRoomSqft = 30;         // law: smallest thing that ships as a room
    public double MinFeatureWidthFt = 2.5;  // law: a room is at least a door wide somewhere
    public double MinBoundarySupport = 0.35;// law: an unbacked shared boundary means one space
    public double InkBackedAcceptMin = 0.5; // law: an accepted room's boundary is majority-backed
    public string LevelNameContains = "";   // matched against host Level.Name
    public string Marker = "PE-TAKEOFF";    // stamped into Comments of everything we create
    public string? ArtifactDir;             // where TSV artifacts land (default: temp)

    // Field-bag by design; a shallow copy is a complete copy (every field is a value type or string).
    public TakeoffOptions Clone() => (TakeoffOptions)this.MemberwiseClone();
}

public sealed class RoomResult {
    public Pe.Revit.Partition.Room? Partition;
    public string Id = "";                  // R01, R02, ... (area-descending)
    public double RawSqft;                  // cell-count area (finish-face-ish)
    public double PerimeterFt;
    public double LabelX, LabelY;           // pole of inaccessibility — inside even for L-shapes
    public double MeanCeilingFt;            // Manual J deliverable
    public List<double[]> Polygon = new();  // outer loop, model coords, CCW, crisp corners
    public List<List<double[]>> Holes = new();
    public List<string> Flags = new();      // ambiguity flags surfaced for review, never resolved silently
    internal string? SplitFrom;             // sidecar provenance for resolved child Spaces
    internal string? MergedFrom;             // sidecar provenance for resolved survivor Spaces
}

public sealed class ResidueResult {
    public Pe.Revit.Partition.Room? Partition;
    public string Id = "";
    public ResidueReason Reason;
    public double RawSqft;
    public double LabelX, LabelY;
    public double MeanCeilingFt;
    public List<double[]> Polygon = new();
    public List<List<double[]>> Holes = new();
}

internal enum DetectorOwnerDisposition { Room, Residue, Excluded }

internal enum DetectorUnownedCause { None, OutsideScope, OutsideFootprint, Obstruction, NonHabitable }

internal sealed record DetectorOwnerMetadata(
    int Label,
    string? OutputId,
    DetectorOwnerDisposition Disposition,
    ResidueReason? ResidueReason);

// Exact detector authority retained in-process. Geometry remains derived output; this is deliberately
// absent from TSV until the whole partition can be serialized and round-tripped together.
internal sealed class DetectorOwnership {
    private readonly int[] ownerByCell;
    private readonly bool[] claimedByCell;
    private readonly DetectorUnownedCause[] unownedCauseByCell;
    private readonly Dictionary<int, DetectorOwnerMetadata> metadata;

    internal DetectorOwnership(
        int width, int height, double minX, double minY, double cellFt,
        int[] ownerByCell, bool[] claimedByCell, DetectorUnownedCause[] unownedCauseByCell,
        IReadOnlyDictionary<int, DetectorOwnerMetadata> metadata) {
        if (ownerByCell.Length != width * height
            || claimedByCell.Length != ownerByCell.Length
            || unownedCauseByCell.Length != ownerByCell.Length)
            throw new ArgumentException("ownership arrays disagree with the detector grid");
        this.Width = width;
        this.Height = height;
        this.MinX = minX;
        this.MinY = minY;
        this.CellFt = cellFt;
        this.ownerByCell = (int[])ownerByCell.Clone();
        this.claimedByCell = (bool[])claimedByCell.Clone();
        this.unownedCauseByCell = (DetectorUnownedCause[])unownedCauseByCell.Clone();
        this.metadata = metadata.ToDictionary(kv => kv.Key, kv => kv.Value);
    }

    internal int Width { get; }
    internal int Height { get; }
    internal double MinX { get; }
    internal double MinY { get; }
    internal double CellFt { get; }
    internal IReadOnlyCollection<DetectorOwnerMetadata> Owners => this.metadata.Values;
    internal int OwnerAt(int cell) => this.ownerByCell[cell];
    internal bool ClaimedAt(int cell) => this.claimedByCell[cell];
    internal DetectorUnownedCause UnownedCauseAt(int cell) => this.unownedCauseByCell[cell];
}

public sealed class TakeoffResult {
    public string LevelName = "";
    public double LevelElevation;           // ProjectElevation (internal origin)
    public TakeoffSource? Source;           // null = detector (legacy); Native = Revit Space readback
    public List<RoomResult> Rooms = new();
    public List<ResidueResult> Residues = new();
    public double TotalSqft;
    // Accounting law inputs: rooms + residues + ExcludedResidueSqft must equal
    // DomainSqft + ClaimedWallSqft, exactly. Populated by the detector; zero for Native readback.
    public double DomainSqft;               // partition domain after any zone mask
    public double ClaimedWallSqft;          // wall-band cells claimed into rooms (outside domain)
    public double ExcludedResidueSqft;      // sub-MinResidueSqft residue suppressed from review
    public string? ProfileProvenance;
    public List<string> LevelFlags = new();
    public string? SeedViewA, SeedViewB;    // names of the stripped seed views (until cleanup)
    public string? EvidenceView;            // rainbow view name (after Annotate)
    internal DetectorOwnership? Ownership;  // exact detector cells; never serialized
    // True once TakeoffPromotion has closed this result: every surviving ROOM is accepted (held
    // rooms were moved to Rejected residues) and ToTsv persists that disposition as an explicit
    // ROOM column instead of leaving it as a convention readers must know. Raw detector output
    // stays false — its rooms have no disposition yet, and its TSV honestly omits the column.
    public bool DispositionsResolved;

    // Tab-separated payload. Polygon coordinates use round-trip precision: six-decimal rounding
    // made valid overlay residue self-intersect on reload. Never serialize geometry at display precision.
    public string ToTsv() {
        var ic = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendLine($"META\tlevel\t{this.LevelName}\nMETA\telev\t{this.LevelElevation.ToString("F6", ic)}");
        if (this.Source != null)
            sb.AppendLine($"META\tsource\t{this.Source.Value.ToString().ToLowerInvariant()}");
        sb.AppendLine($"META\trooms\t{this.Rooms.Count}\nMETA\ttotalSqft\t{this.TotalSqft.ToString("F1", ic)}");
        if (this.ProfileProvenance != null) sb.AppendLine($"META\tprofile\t{this.ProfileProvenance}");
        foreach (string flag in this.LevelFlags) sb.AppendLine($"META\tflag\t{flag}");
        // Disposition column (SHIMS.md #3 close): a promoted TSV says "accepted" on every ROOM
        // line outright. Held rooms are the Rejected residues below — that mapping is the
        // persisted contract (ZonePromotionDiagnostics counts HeldRooms exactly that way), not a
        // renderer convention. A 7-column ROOM line means the package predates the column or is
        // raw detector output: disposition unknown, and readers must not assume accepted.
        string disposition = this.DispositionsResolved ? "\taccepted" : "";
        foreach (var r in this.Rooms) {
            sb.AppendLine($"ROOM\t{r.Id}\t{r.RawSqft.ToString("F1", ic)}\t{r.PerimeterFt.ToString("F1", ic)}\t{r.LabelX.ToString("F6", ic)}\t{r.LabelY.ToString("F6", ic)}\t{r.MeanCeilingFt.ToString("F2", ic)}{disposition}");
            sb.AppendLine($"POLY\t{r.Id}\touter\t{PolyStr(r.Polygon)}");
            foreach (var h in r.Holes) sb.AppendLine($"POLY\t{r.Id}\thole\t{PolyStr(h)}");
        }
        // Ambiguity flags ride as 3-column META lines; consumers ignore unknown META keys.
        foreach (var r in this.Rooms.Where(r => r.Flags.Count > 0))
            sb.AppendLine($"META\tflag\t{r.Id}:{string.Join("+", r.Flags)}");
        foreach (var r in this.Rooms.Where(r => r.SplitFrom != null))
            sb.AppendLine($"META\tsplitFrom\t{r.Id}:{r.SplitFrom}");
        foreach (var r in this.Rooms.Where(r => r.MergedFrom != null))
            sb.AppendLine($"META\tmergedFrom\t{r.Id}:{r.MergedFrom}");
        foreach (var r in this.Residues)
            sb.AppendLine($"META\tresidue\t{r.Id}\t{r.Reason.ToString().ToLowerInvariant()}\t{r.RawSqft.ToString("F1", ic)}\t{r.LabelX.ToString("F6", ic)}\t{r.LabelY.ToString("F6", ic)}\t{r.MeanCeilingFt.ToString("F2", ic)}\t{PolyStr(r.Polygon)}{string.Concat(r.Holes.Select(h => "\t" + PolyStr(h)))}");
        return sb.ToString();
    }

    private static string PolyStr(List<double[]> p) =>
        string.Join("|", p.Select(v => v[0].ToString("R", CultureInfo.InvariantCulture) + ";" + v[1].ToString("R", CultureInfo.InvariantCulture)));
}
