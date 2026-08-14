namespace Pe.Revit.Takeoff;

// Room-takeoff contracts: the per-room payload the RHVAC / OpenStudio exporter consumes (sqft,
// perimeter, wall segments, interior label point, polygon, mean ceiling height). Detection must
// not depend on native Room names — architects place Rooms in only ~1/4-1/3 of spaces, so names
// are matched on later by containment. See docs/features/takeoffs/rhvac-and-mj-reference.md.

// Partition seed source (one seed = one candidate space before merges/dissolution):
// RegionCores = connected components of unobstructed domain; Hybrid = cores, except a core with
// >= 2 distance-transform plateaus is seeded by them so open-plan cores split along interior
// evidence ridges (ceiling/floor steps). Standalone distance-maxima seeding is falsified
// (under-seeds closets/baths, 41.9 vs 52.8 — see DECISIONS.md).
public enum TakeoffSeedSource { RegionCores, Hybrid }
public enum TakeoffSource { Detector, Native }
public enum ResidueReason { Border, Crumb, Rejected }

public sealed class TakeoffOptions
{
    public bool InferLevelProfile = true;   // false = caller owns every policy knob explicitly
    public string LevelNameContains = "";   // matched against host Level.Name
    public double CellFt = 0.25;            // grid resolution; 0.25 resolves stud walls
    public double MinSqft = 20;             // retain small closets/baths for review
    public double MinResidueSqft = 20;      // suppress tiny unclaimed crumbs/leaks in the review UI
    public double MinHeadroomFt = 6.0;      // walkable = ceiling - floor >= this (kills eaves)
    public double FloorTolFt = 1.5;         // floor must sit within +/- this of level plane
    public double GapSealFt = 1.5;          // closes stud/dash gaps in section ink; larger closes damage corners
    public bool RequireCeiling = false;     // ceiling presence joins the per-cell existence mask (terraces stay out)
    public bool SealDoorHeads = false;      // seal a doorway where a low lintel sits between taller ceilings
    public double DoorHeadMaxFt = 8.75;     // max headroom that can still be a door/opening lintel
    public double DoorHeadContrastFt = 1.5; // neighbor must be this much taller to call the low cell a lintel
    public bool SealWallRunGaps = false;    // close a colinear break in a wall run (headerless doorway)
    public double DoorGapMaxFt = 4.5;       // widest colinear break that can still be a doorway
    public double DoorJambMinFt = 2.0;      // ink run required on BOTH sides to call it a doorway
    public double StoryCapFt = 14.0;        // ceiling search cap above the level plane
    public double CeilingCloseFt = 0;       // close gaps <= this in the ceiling mask (rafter-only roofs read patchy)
    public double BoundarySimplifyFt = 2.0; // physical wall-fit tolerance for raster boundary chains
    public double MinimumPromotedRoomSqft = 30; // smaller unambiguous pockets merge into sole neighbor
    public double WallClaimFt = 1.5;        // wall-band claim reach per side: cells seen by distinct rooms
                                            // within this reach split at the band centerline so rooms TOUCH (0 = off)
    public double BandPairSeparationFt = 0.75; // band A is cut again this far BELOW KneeBandFt; only ink in BOTH
                                               // cuts counts (walls survive, rafters/joists/labels shift or vanish).
                                               // Second cut goes DOWN: knee walls end just above KneeBandFt.
    public double HeaderNearFt = 6.0;       // header ink counts only within this reach of knee ink / slab edge;
                                            // must cover HALF the widest opening or wide-window headers unseal
    public double KneeBandFt = 4.0;         // seed band A: catches knee walls + under-window studs
    public double HeaderBandFt = 8.5;       // seed band B: ABOVE door/window heads = geometric door sealing.
                                            // Estimate per model: stud-top histogram (plate height) minus ~2 ft.
    public int SeedPixelSize = 6000;        // ImageExportOptions.PixelSize for seed exports
    public string? EvidenceReferenceViewName; // production view whose graphics + orientation evidence should match
    public bool DumpReplaySnapshot = true;  // persist post-Revit inputs as replay_<level>.bin for offline
                                            // DetectSnapshot.Replay (see DetectSnapshot header for live-only steps)
    // ---- Partition formulation knobs (PartitionFormulation.cs) ----
    // Defaults, not per-project constants: evidence weights are calibratable; widths follow building
    // conventions (door ~2.5 ft).
    public TakeoffSeedSource SeedSource = TakeoffSeedSource.RegionCores;
    public double SeedClearFt = 3.0;        // DistanceMaxima: seed plateau must sit this clear of strong evidence
    public double CeilStepEvidenceFt = 0.75;   // ceiling-height jump where boundary evidence starts
    public double CeilStepSaturationFt = 2.5;  // jump size at which it saturates to CeilStepWeight
    public double CeilStepWeight = 0.7;
    public double FloorStepEvidenceFt = 0.35;  // floor steps (sunken rooms) as boundary evidence
    public double FloorStepSaturationFt = 1.5;
    public double FloorStepWeight = 0.45;      // below BoundaryEvidenceMin BY DESIGN: floor steps guide watershed
                                               // placement but cannot certify a boundary (sunken rooms are one room)
    public double BoundaryEvidenceMin = 0.5;   // a boundary edge is "backed" when either side's evidence reaches this
    public double MinBoundarySupport = 0.35;   // merge two spaces when less than this fraction of shared boundary is backed
    public double LowBoundarySupportFlag = 0.6; // surviving boundary below this backing fraction flags both rooms
    public double MinFeatureWidthFt = 2.5;     // sliver dissolution: a space must be at least a door width wide somewhere
    public double MinRegionCompactness = 0.01; // flag extreme snakes; preserves narrow real rooms for review
    public double SuspectMaxSqft = 60;         // non-geometric suspect signals only target pockets
    public double MinSuspectCeilingStdDevFt = 0.5; // chases/voids cross multiple ceiling bands; uniform closets do not
    public string Marker = "PE-TAKEOFF";    // stamped into Comments of everything we create
    public string? ArtifactDir;             // where TSV/PNG artifacts land (default: temp)
}

public sealed class RoomResult
{
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

public sealed class ResidueResult
{
    public string Id = "";
    public ResidueReason Reason;
    public double RawSqft;
    public double LabelX, LabelY;
    public double MeanCeilingFt;
    public List<double[]> Polygon = new();
    public List<List<double[]>> Holes = new();
}

public sealed class TakeoffResult
{
    public string LevelName = "";
    public double LevelElevation;           // ProjectElevation (internal origin)
    public TakeoffSource? Source;           // null = detector (legacy); Native = Revit Space readback
    public List<RoomResult> Rooms = new();
    public List<ResidueResult> Residues = new();
    public double TotalSqft;
    public string? ProfileProvenance;
    public List<string> LevelFlags = new();
    public string? SeedViewA, SeedViewB;    // names of the stripped seed views (until cleanup)
    public string? EvidenceView;            // rainbow view name (after Annotate)

    // Tab-separated payload; F6 precision is load-bearing — rounding flips geometric tie-breaks and
    // changes room counts. Never serialize detection geometry at display precision.
    public string ToTsv()
    {
        var ic = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendLine($"META\tlevel\t{this.LevelName}\nMETA\telev\t{this.LevelElevation.ToString("F6", ic)}");
        if (this.Source != null)
            sb.AppendLine($"META\tsource\t{this.Source.Value.ToString().ToLowerInvariant()}");
        sb.AppendLine($"META\trooms\t{this.Rooms.Count}\nMETA\ttotalSqft\t{this.TotalSqft.ToString("F1", ic)}");
        if (this.ProfileProvenance != null) sb.AppendLine($"META\tprofile\t{this.ProfileProvenance}");
        foreach (string flag in this.LevelFlags) sb.AppendLine($"META\tflag\t{flag}");
        foreach (var r in this.Rooms)
        {
            sb.AppendLine($"ROOM\t{r.Id}\t{r.RawSqft.ToString("F1", ic)}\t{r.PerimeterFt.ToString("F1", ic)}\t{r.LabelX.ToString("F6", ic)}\t{r.LabelY.ToString("F6", ic)}\t{r.MeanCeilingFt.ToString("F2", ic)}");
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
        string.Join("|", p.Select(v => v[0].ToString("F6", CultureInfo.InvariantCulture) + ";" + v[1].ToString("F6", CultureInfo.InvariantCulture)));
}
