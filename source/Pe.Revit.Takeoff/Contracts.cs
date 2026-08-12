namespace Pe.Revit.Takeoff;

// Room-takeoff contracts. The payload below is the frozen seed of the rvt -> RHVAC / OpenStudio
// exporter (Manual J + energy modeling): per room — sqft under the firm convention, perimeter,
// wall segments with lengths + interior/exterior class, an interior label point, the polygon,
// and mean ceiling height. Detection and NAMING are separate problems: architects place Rooms in
// only ~1/4-1/3 of real spaces (Snowdon round 1), so names come later by containment-matching
// link Rooms where they exist; detection must not depend on them.
//
// Boundary convention (firm standard, locked 2026-07-03): CENTERLINE on interior partitions,
// OUTSIDE FACE on envelope walls. The convention is where the accuracy is, not a cosmetic knob —
// raw finish-face undershoots oracle areas 15-25%. On wall-less framing models (IFC stud soup)
// only finish-face is directly observable; convention offsets need a wall-thickness estimate
// (probe) or real Wall elements.
// Detection is a partition of the covered domain via boundary-evidence watershed: no holes,
// shared boundaries, sliver dissolution, and explicit ambiguity flags by construction.
// Where partition seeds come from (one seed = one candidate space before merges/dissolution):
// RegionCores = connected components of unobstructed domain;
// DistanceMaxima = plateaus of the distance transform to strong boundary evidence;
// Hybrid = cores, except a core containing >= 2 distance plateaus is seeded by those plateaus
// instead — open-plan cores can then split along interior evidence ridges (ceiling/floor steps),
// while evidence-free cores stay whole (measured: pure DistanceMaxima under-seeds closets/baths,
// 41.9 vs 52.8 TOTAL).
public enum TakeoffSeedSource { RegionCores, DistanceMaxima, Hybrid }
public enum TakeoffSource { Detector, Native }
public enum ResidueReason { Border, Crumb, Rejected }

public sealed class TakeoffOptions
{
    public bool InferLevelProfile = true;   // derive level policy from heightfield + ink; false =
                                            // caller owns every policy knob explicitly
    public string LevelNameContains = "";   // matched against host Level.Name
    public double CellFt = 0.25;            // grid resolution; 0.25 resolves stud walls
    public double MinSqft = 20;             // retain small closets/baths for Pea-human review
    public double MinResidueSqft = 20;      // suppress tiny unclaimed crumbs/leaks in the review UI
    public double MinHeadroomFt = 6.0;      // walkable = ceiling - floor >= this (kills eaves)
    public double FloorTolFt = 1.5;         // floor must sit within +/- this of level plane
    public double GapSealFt = 1.5;          // closes stud/dash gaps in physical View3D section ink.
                                            // project-a slab sweep: 1.0 found 11 rooms, 1.5 found 45,
                                            // and 2.0 regressed to 44; larger closes damage corners.
    public bool RequireCeiling = false;     // ceiling presence joins the per-cell existence mask,
                                            // so terraces/aprons never join the partition domain
    public bool SealDoorHeads = false;      // EXPERIMENT: a doorway reads in the heightfield as a
                                            // short strip whose CeilZ is the lintel (~7-8 ft) while
                                            // flanking cells carry the full ceiling. Cells with
                                            // headroom <= DoorHeadMaxFt that sit within a few cells
                                            // of markedly taller ones become obstruction, sealing
                                            // openings from geometry instead of header-band ink.
    public double DoorHeadMaxFt = 8.75;     // max headroom that can still be a door/opening lintel
    public double DoorHeadContrastFt = 1.5; // neighbor must be at least this much taller to call
                                            // the low cell a lintel (protects genuinely low rooms)
    public bool SealWallRunGaps = false;    // EXPERIMENT: close a short gap in the obstruction
                                            // mask only when it is a colinear break in a wall run
                                            // (a headerless doorway), scanning H, V and both 45s —
                                            // framing models have no lintel geometry to find.
    public double DoorGapMaxFt = 4.5;       // widest colinear break that can still be a doorway
    public double DoorJambMinFt = 2.0;      // ink run required on BOTH sides to call it a doorway
    public double StoryCapFt = 14.0;        // ceiling search cap above the level plane (was a
                                            // hardcode; double-height spaces and attic roofs need
                                            // more, stair voids argue for less — per-level policy)
    public double CeilingCloseFt = 0;       // close gaps <= this in the ceiling mask (rafter-only
                                            // roofs read patchy at framing stage; attic policy)
    public double BoundarySimplifyFt = 2.0; // physical wall-fit tolerance for raster boundary chains
    public double MinimumPromotedRoomSqft = 30; // smaller unambiguous pockets merge into their
                                                // sole neighbor; ambiguous pockets stay residue
    public double WallClaimFt = 1.5;        // wall-band claim reach per side: non-domain cells
                                            // seen by distinct rooms within this reach are
                                            // split at the band centerline so rooms TOUCH (0 = off)
    public double BandPairSeparationFt = 0.75; // vertical-consistency AND: band A is also cut this
                                               // far BELOW KneeBandFt and only ink present in BOTH
                                               // cuts counts. Walls extrude vertically so they
                                               // survive; rafters, joists, battens, gutters, stair
                                               // flights, raked railings, and flat LABEL junk shift
                                               // or vanish. The second cut goes DOWN, not up: knee
                                               // walls end just above KneeBandFt, and a higher cut
                                               // erased them (project-a round 2 lost 9 real rooms).
    public double HeaderNearFt = 6.0;       // header-band ink only counts within this reach of
                                            // knee ink: headers live over openings BETWEEN walls,
                                            // so mid-room roof planes in the header cut are noise.
                                            // Must cover HALF the widest opening: at 4.0 the gate
                                            // discarded wide-window headers and unsealed the
                                            // envelope (project-a round 3, bedroom wing)
    public double KneeBandFt = 4.0;         // seed band A: catches knee walls + under-window studs
    public double HeaderBandFt = 8.5;       // seed band B: ABOVE door/window heads, where framing
                                            // is continuous = geometric door sealing. Estates run
                                            // 10 ft ceilings / 8 ft heads; 6'8"-head stock is ~7.0.
                                            // Estimate per model: stud-top histogram (plate height)
                                            // minus ~2 ft. Three independent pods converged here.
    public int SeedPixelSize = 6000;        // ImageExportOptions.PixelSize for seed exports
    public string? EvidenceReferenceViewName; // production view whose graphics + orientation evidence should match
    public bool DumpReplaySnapshot = true;  // Detect persists its post-Revit inputs (heightfield +
                                            // seed ink) as replay_<level>.bin so detection changes
                                            // iterate OFFLINE via DetectSnapshot.Replay — see the
                                            // DetectSnapshot header for what stays live-only
    // ---- Partition formulation knobs (PartitionFormulation.cs) ----
    // Mechanisms with defaults, not per-project constants: evidence weights are calibratable
    // (eval/rhvac ground-truth wall lines), widths come from building conventions (door ~2.5 ft).
    public TakeoffSeedSource SeedSource = TakeoffSeedSource.RegionCores;
    public double SeedClearFt = 3.0;        // DistanceMaxima: seed plateau must sit at least this
                                            // clear of strong evidence / domain edge
    public double CeilStepEvidenceFt = 0.75;   // ceiling-height jump where boundary evidence starts
    public double CeilStepSaturationFt = 2.5;  // jump size at which it saturates to CeilStepWeight
    public double CeilStepWeight = 0.7;
    public double FloorStepEvidenceFt = 0.35;  // floor steps (sunken rooms) as boundary evidence
    public double FloorStepSaturationFt = 1.5;
    public double FloorStepWeight = 0.45;      // below BoundaryEvidenceMin BY DESIGN: floor steps
                                               // guide watershed placement but cannot certify a
                                               // boundary (theater tiers, sunken rooms are one
                                               // room; measured anti-signal on the attic)
    public double BoundaryEvidenceMin = 0.5;   // a boundary edge is "backed" when either side's
                                               // evidence reaches this
    public double MinBoundarySupport = 0.35;   // merge two spaces when less than this fraction of
                                               // their shared boundary is backed (open-plan flag)
    public double LowBoundarySupportFlag = 0.6; // surviving boundary below this backing fraction
                                                // flags both rooms low-evidence-boundary
    public double MinFeatureWidthFt = 2.5;     // sliver dissolution: a space must be at least a
                                               // door width wide somewhere
    public double MinRegionCompactness = 0.01; // flag extreme snakes; iteration-3 floor preserves
                                               // narrow real rooms for one-touch review
    public double SuspectMaxSqft = 60;         // non-geometric suspect signals only target pockets,
                                               // not ordinary rooms with varied ceilings
    public double MinSuspectCeilingStdDevFt = 0.5; // chases/voids cross multiple ceiling bands;
                                                   // uniform closets usually do not
    public string Marker = "PE-TAKEOFF";    // stamped into Comments of everything we create
    public string? ArtifactDir;             // where TSV/PNG artifacts land (default: temp)
}

public sealed class RoomResult
{
    public string Id = "";                  // R01, R02, ... (area-descending)
    public double RawSqft;                  // cell-count area (finish-face-ish)
    public double PerimeterFt;
    public double LabelX, LabelY;           // pole of inaccessibility — inside even for L-shapes
    public double MeanCeilingFt;            // heightfield deliverable; Manual J wants this
    public List<double[]> Polygon = new();  // outer loop, model coords, CCW, crisp corners
    public List<List<double[]>> Holes = new();
    public List<string> Flags = new();      // ambiguity flags (partition formulation): open-plan
                                            // merges, low-evidence boundaries, seedless pockets.
                                            // Never guessed intent — surfaced for human/pea review.
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

    // Tab-separated payload; full precision matters — F6 rounding flipped geometric tie-breaks
    // and changed room counts in round 1. Never serialize detection geometry at display precision.
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
        // Ambiguity flags ride as 3-column META lines: existing consumers (score-takeoff.py,
        // TakeoffTsv.ParseTsv) ignore unknown META keys, so the format stays
        // backward-compatible with consumers that predate ambiguity flags.
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
