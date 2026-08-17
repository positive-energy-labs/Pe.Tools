namespace Pe.Revit.Takeoff;

// Room-takeoff contracts: the per-room payload the RHVAC / OpenStudio exporter consumes (sqft,
// perimeter, wall segments, interior label point, polygon, mean ceiling height). Detection must
// not depend on native Room names — architects place Rooms in only ~1/4-1/3 of spaces, so names
// are matched on later by containment. See docs/features/takeoffs/rhvac-and-mj-reference.md.

// Partition seed source (one seed = one candidate space before merges/dissolution):
// RegionCores = connected components of unobstructed domain; Hybrid = cores, except a core with
// >= 2 distance-transform plateaus is seeded by them so open-plan cores split along interior
// evidence ridges (ceiling/floor steps). DistanceMaxima is standalone plateau seeding: falsified as
// a default (under-seeds closets/baths, 41.9 vs 52.8 — see DECISIONS.md), retained last in the enum
// as the A/B control that makes Hybrid's contribution measurable rather than assumed.
public enum TakeoffSeedSource { RegionCores, Hybrid, DistanceMaxima }
public enum TakeoffSource { Detector, Native }
public enum ResidueReason { Border, Crumb, Rejected, Excluded }

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
    public double DoorGapMaxFt = 6.0;       // widest colinear break that can still be a doorway (6.0 valid only atop diagonal-honest scan steps; kaitpw A/B 2026-08-16)
    public double DoorJambMinFt = 2.0;      // ink run required on BOTH sides to call it a doorway
    public double StoryCapFt = 14.0;        // ceiling search cap above the level plane
    public double CeilingCloseFt = 0;       // close gaps <= this in the ceiling mask (rafter-only roofs read patchy)
    public double BoundarySimplifyFt = 2.0; // physical wall-fit tolerance for raster boundary chains
                                            // (coarsening falsified twice — see DECISIONS 2026-08-14)
    // ---- Shared-boundary regularizer frame snapping (SpaceBoundaryNetwork.cs) ----
    // 35/12 are the fan-out-tuned values (+4 rooms, BoundaryDrift 25->21, ink flat); the rest are
    // the consts that stage always carried. SnapTol 45/20 is a per-zone area-dominant lever.
    public double BoundarySnapToleranceDeg = 35;  // long edge joins a frame axis within this
    public double BoundarySnapShortDeg = 12;      // short edges must be nearly on-axis already
    public double BoundarySnapShortFt = 6;        // the long/short boundary
    public double BoundarySnapMinFt = 1.0;        // below this an edge is raster noise: hands off
    public double BoundaryFrameClusterDeg = 6;    // mod-90 angle clustering width
    public double BoundaryFrameMinShare = 0.10;   // a frame owns at least this edge-weight share
    public double BoundaryRunGapFt = 0.4;         // collinear run: max offset gap to the previous
    public double BoundaryRunSpanFt = 0.75;       // collinear run: max total offset spread
    public double MinimumPromotedRoomSqft = 30; // smaller unambiguous pockets merge into sole neighbor
    public double WallClaimFt = 1.5;        // wall-band claim reach per side: cells seen by distinct rooms
                                            // within this reach split at the band centerline so rooms TOUCH (0 = off)
    public double BandPairSeparationFt = 0.75; // band A is cut again this far BELOW KneeBandFt; only ink in BOTH
                                               // cuts counts (walls survive, rafters/joists/labels shift or vanish).
                                               // Second cut goes DOWN: knee walls end just above KneeBandFt.
    public double HeaderNearFt = 6.0;       // header ink counts only within this reach of knee ink / slab edge;
                                            // must cover HALF the widest opening or wide-window headers unseal
    public double FramingLowBandFt = 1.0;   // framing-only support cut near the floor: wall-formers (studs)
                                            // run down to their plate; joists/blocking/collar ties at knee
                                            // height have no footprint here (project-a attic, measured: 4,200
                                            // of 6,145 band framing members were not studs)
    public double FramingLowSupportNearFt = 1.5; // knee framing ink counts only within this reach of the
                                                 // low-cut framing footprint (covers 16" stud spacing)
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
    public TakeoffSeedSource SeedSource = TakeoffSeedSource.Hybrid;
    public double SeedClearFt = 1.5;        // DistanceMaxima: seed plateau must sit this clear of strong evidence
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
    // ---- Pre-solve zone triage (ZoneTriage.cs) ----
    // Defaults are the project-a-tuned values (2026-08-14 A/B sweep, exp-e4/e7 in the reeval doc);
    // 0 disables any of them. SmallZoneLowInkSqft/MinZoneInkRatio stay off: with band-composed ink
    // the ratio measures clutter, not wall density — revisit when ink comes from the DWG lane.
    public double SmallZoneSqft = 750;      // zone at or under this holds whole, unsolved (0 = off);
                                            // 17 of 19 such project-a zones never produced an accepted room
    public double SmallZoneLowInkSqft = 0;  // larger hold threshold for a zone below MinZoneInkRatio (0 = off)
    public double MinZoneInkRatio = 0.0;    // in-zone ink cells / zone cells below which ink is too
                                            // sparse to be a wall network worth partitioning
    // ---- Pre-solve ink hygiene (InkHygiene.cs) ----
    public int InkClusterWhiteoutCells = 100; // drop floating in-zone ink clusters smaller than this (0 = off)
    public double InkClusterWhiteoutBboxFt = 0; // ...or fitting inside this square, whatever their cell count
    // ---- Post-solve disposition recombination (TakeoffPromotion.cs stages) ----
    public double AbsorbNeighborMaxSqft = 60;  // room under this area may absorb into a neighbor (0 = off)
    public double AbsorbNeighborSharedPerimeterFraction = 0.45; // ...holding this share of its perimeter; measured
                                            // project-a ceiling is 0.54 (0.6 never fires); 0.30 is a per-zone lever
                                            // that cracks lattice zones (LL08) but bulldozes good rooms elsewhere
    public double EdgeBandFt = 2.0;            // band inside the zone boundary that recombines outward (0 = off)
    public double EdgeBandAreaFraction = 0.5;  // room with this much area inside the band merges inward
    // ---- Frame-local projection (FrameLocalProjector.cs) ----
    // The projector re-cuts a room onto shared rails; these tolerances decide how much the re-cut
    // may disagree with the watershed room before the room is held whole instead. Drift is the ink
    // honesty budget — ink is EVIDENCE, so a projection that wanders far from it is not trustworthy.
    // 2.5 ft / 20% are the fan-out winners (measured): the shipped 1.5/0.10 held rooms whose only
    // sin was a raster-resolution corner, and the canonical editability audit downstream is what
    // actually stops sloppy geometry — not these two numbers.
    public double FrameMaxBoundaryDriftFt = 2.5;  // how far a PROJECTED boundary may sit from the source
    public double FrameMaxSourceDropFt = 2.5;     // how far a SOURCE feature may sit from the projection
    public double FrameMaxAreaDrift = 0.20;       // |projected - source| / source area tolerance
    public double FrameMinFrameSupport = 0.42;    // length share of a room's edges on its best frame
    public double FrameRailMergeFt = 0.55;        // rail offsets closer than this collapse to one rail
    public double FrameRailGapFt = 1.1;           // colinear edge spans closer than this form one run
    public double FrameMinRailEdgeFt = 0.75;      // shortest edge admitted as a rail observation
    public double FrameComponentGapFt = 0.55;     // room separation that still shares a rail set
    // Douglas-Peucker tolerance applied before ANY frame/rail angle measurement. It exists to melt
    // the raster staircase (amplitude <= CellFt/sqrt2 = 0.18 ft at 0.25) back into the wall it
    // samples; every foot above that is chord noise the circular mean pays for in frame ANGLE
    // error. On a 45-degree wing that error is what decides whether a room's rails agree with the
    // declared zone edge to within the 0.25-degree editability tolerance.
    public double FrameDeStaircaseFt = 1.0;
    // The zone boundary is DECLARED, so its angle is known exactly where a raster-measured frame is
    // only estimated. When the projector's measured frame lands within this many degrees of the
    // zone's own dominant angle, the declared angle wins: the estimate is inside its own noise, and
    // agreeing with the authority is what lets zone-fit clip a room without the cut edge reading as
    // OffFrameEdge against the 0.25-degree editability tolerance. Beyond this margin the two are
    // genuinely different frames and the measurement stands. 0 disables.
    public double FrameZoneSnapDeg = 1.0;
    // ---- Zone fit (TakeoffPromotion zone-fit stage) ----
    // The zone boundary is user-declared AUTHORITY, not evidence: where ink only earns a drift
    // budget, the zone edge is simply where the room ends. Snap pulls a room edge lying just inside
    // the zone onto it (killing void slivers); clip intersects an overhanging room with the zone
    // (trimming instead of rejecting). Both re-run the strict editability audit and fall back to the
    // pre-fit geometry on failure — e.g. a zone edge diagonal to the room's frame.
    public double ZoneSnapFt = 1.0;         // room vertex this close to the zone boundary snaps onto it (0 = off)
    public bool ZoneClipEnabled = true;     // a room overhanging the zone is intersected with it, not rejected
    // ---- Ink-backing acceptance gate (TakeoffPromotion ink-backing stage) ----
    // Teal must mean trustworthy: an accepted room's boundary must actually stand on wall ink.
    // Samples near the zone edge are exempt (zone is authority, not evidence), so a room whose
    // remaining boundary is mostly unbacked — the signature of seal-manufactured partitions in
    // ink-starved zones — is held instead of accepted. 0 disarms.
    public double InkBackedAcceptMin = 0.5;    // minimum backed fraction of non-zone-edge boundary
    public double InkBackedZoneEdgeExemptFt = 1.0; // boundary samples this close to the zone edge don't count
    // ---- Per-zone adaptive policy (ZonePolicy.cs) ----
    // On: a zone's census + raw partition may override the knobs above for that zone alone, and
    // every deviation is reported into report.json. See ZonePolicy for the rules and their grounding.
    // MEASURED COST, 2026-08-14 composite: ON costs 6 accepted rooms and 115 sf against OFF, all of
    // it in the two zones the sparse-wall rule fires on (Lower 08: 8 vs 12, Lower 09: 7 vs 9). The
    // rule was calibrated when the frame projector held those lattice cells at 1.5 ft / 10% drift,
    // so absorbing them was a gain; under the relaxed 2.5 ft / 20% budget the projector now ACCEPTS
    // them as rooms and the rule spends them. OFF by that evidence: the seam stays (pure, inert,
    // fully attributed via adaptedKnobs) but its one live rule is falsified at the current drift
    // budget — rearm only after recalibrating SparseWallInkRatio against a projector this loose.
    public bool AdaptivePolicy = false;
    public double SparseWallInkRatio = 0.09;   // below this in-zone ink ratio the wall network is too
                                               // sparse to certify the partitions drawn against it
    public int SparseWallMinRawRooms = 4;      // ...and only where a real multi-room partition exists
    public double SparseWallAbsorbSharedPerimeterFraction = 0.30; // absorb share such a zone uses
    public string Marker = "PE-TAKEOFF";    // stamped into Comments of everything we create
    public string? ArtifactDir;             // where TSV/PNG artifacts land (default: temp)

    // Field-bag by design; a shallow copy is a complete copy (every field is a value type or string).
    public TakeoffOptions Clone() => (TakeoffOptions)this.MemberwiseClone();
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
    // Accounting law inputs: rooms + residues + ExcludedResidueSqft must equal
    // DomainSqft + ClaimedWallSqft, exactly. Populated by the detector; zero for Native readback.
    public double DomainSqft;               // partition domain after any zone mask
    public double ClaimedWallSqft;          // wall-band cells claimed into rooms (outside domain)
    public double ExcludedResidueSqft;      // sub-MinResidueSqft residue suppressed from review
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
