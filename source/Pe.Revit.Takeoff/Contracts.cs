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
    public double DoorHeadMaxComponentFt = 9.0; // widest connected lintel component that still reads as a door/opening; larger is a soffit/low slab (seals wall fringe only, never backs)
    public bool SealWallRunGaps = false;    // close a colinear break in a wall run (headerless doorway)
    public double DoorGapMaxFt = 6.0;       // 6.0 is adopted atop diagonal-honest scan steps; 6.75 is tombstoned in the takeoffs ledger
    public double DoorJambMinFt = 2.0;      // ink run required on BOTH sides to call it a doorway
    public double StoryCapFt = 14.0;        // ceiling search cap above the level plane
    public double CeilingCloseFt = 0;       // close gaps <= this in the ceiling mask (rafter-only roofs read patchy)
    public double BoundarySimplifyFt = 2.0; // physical wall-fit tolerance for raster boundary chains
                                            // (coarsening falsified twice — LEDGER 2026-08-14)
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
    public TakeoffSeedSource SeedSource = TakeoffSeedSource.RegionCores;
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
    // SmallZoneSqft is a user-exposed per-project toggle (kaitpw 2026-08-16): high-end residential
    // wants ~750, typical projects smaller. Do not fixture-tune the default. The low-ink refinement
    // (SmallZoneLowInkSqft/MinZoneInkRatio) was deleted 2026-08-16: never armed, and inkRatio was
    // falsified as a per-zone discriminator on framing-clean bins (DECISIONS 2026-08-16).
    public double SmallZoneSqft = 750;      // zone at or under this holds whole, unsolved (0 = off);
                                            // 17 of 19 such project-a zones never produced an accepted room
    // ---- Pre-solve ink hygiene (InkHygiene.cs) ----
    public int InkClusterWhiteoutCells = 100; // drop floating in-zone ink clusters smaller than this (0 = off)
    // ---- Zone-edge ink pull (PartitionFormulation.Run) ----
    // Designers draw zone edges THROUGH walls (2026-08-16 survey: 83% of all project-a zone-boundary
    // length has ink within 0.5 ft), so the mask clips a wall-thickness band of ink — and, raster-
    // side, often a free sliver between that band and the declared line. Both are padding, not
    // room: armed, the partition's effective domain pulls to the ink band's INTERIOR face.
    // Edge-hugging obstruction within this depth of the declared edge leaves the working mask
    // (never claimable), together with free slivers sealed between that ink and the edge; a free
    // strip that opens into the room (an OPEN zone edge — the zone is authority, not evidence) is
    // never touched. The declared zone remains the authority for clip, scope, and accounting.
    // DEFAULT 0 — falsified as a global default (2026-08-16 R3c): the hybrid seeder reads
    // distance-transform plateaus over the domain, so shaving even 0.75 ft off the domain edge
    // moves seeds deep inside edge-adjacent rooms and re-rolls whole partitions (UL02 +4 oracle
    // rooms, ML09 0->3, LL08 0->1 — but ML00 3->0, UL03 6->2, UL05 8->3, Attic00 4->1; board
    // savedWork -16% at every swept depth). Reopen only WITH seed placement that is stable under
    // edge shave. The zone-fit snap's refusal to sweep an edge across ink (same taste source:
    // kaitpw round-2, "zone edges often clip walls") is unconditional and lives in SnapToZone,
    // not behind this knob.
    public double ZoneEdgeInkPullFt = 0;
    // ---- Post-solve disposition recombination (TakeoffPromotion.cs stages) ----
    public double AbsorbNeighborMaxSqft = 60;  // room under this area may absorb into a neighbor (0 = off)
    public double AbsorbNeighborSharedPerimeterFraction = 0.45; // ...holding this share of its perimeter; measured
                                            // project-a ceiling is 0.54 (0.6 never fires); 0.30 is a per-zone lever
                                            // that cracks lattice zones (LL08) but bulldozes good rooms elsewhere
    public double AbsorbNakedMaxSqft = 0;   // naked-separator absorb candidacy extends to rooms under this
                                            // area (0 = candidacy stays AbsorbNeighborMaxSqft). FALSIFIED AS
                                            // A GLOBAL DEFAULT at 400 (exp/ll08-forensics 2026-08-17): in the
                                            // starved zone it was aimed at (LL08 inkRatio 0.05) nakedness
                                            // cannot tell a real wall from a watershed line — it absorbed the
                                            // zone's one high-confidence oracle room (Mech 023, naked=0.93,
                                            // its real walls have no raster ink) — and elsewhere one 64 sf
                                            // naked=0.94 merge re-rolled a neighbor's zone-fit and broke the
                                            // per-room honesty bar (ML05 R12 edge-on-ink -0.021). Nakedness
                                            // ordering cannot separate the harm (0.94) from the good (ML08's
                                            // honest +2 rooms came at naked=0.84). Reopen only as a per-zone
                                            // rule keyed on ink trust (AdaptivePolicy seam, recalibration
                                            // ritual) — never as a default.
    public double AbsorbNakedSeparatorFraction = 0.6; // multi-neighbor absorb: when no single neighbor
                                            // clears the share bar but the TOTAL neighbor-shared perimeter does,
                                            // merge only if at least this fraction of the shared boundary stands
                                            // on NO WALL INK (seed ink; door-heads are openings, plugs are
                                            // heuristics — neither is a wall). An unbacked separator is a
                                            // watershed line, not a wall. Board raw census 2026-08-16: genuine
                                            // small rooms (closets) top out at 0.46 naked; watershed slivers sit
                                            // at 0.64-1.00 (LL09 R04 = 0.95). 0.6 splits with margin. 0 = off.
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
    // Drop is deliberately split from invention (decided 2026-08-15, LEDGER): byte-identical at
    // 2.5/2.5, and the sweep says loosening it only pays at >=7.8 ft (one 547 sf LL08 room).
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
    // Adopted 2026-08-15 (LEDGER): ML05's wing measured 45.267 deg against a zone drawn at 45.000,
    // and the 0.25 deg editability tolerance split that hair. Board 59->69 accepted (+2,509 sf).
    public double FrameZoneSnapDeg = 1.0;
    // ---- Zone fit (TakeoffPromotion zone-fit stage) ----
    // The zone boundary is user-declared AUTHORITY, not evidence: where ink only earns a drift
    // budget, the zone edge is simply where the room ends. Snap pulls a room edge lying just inside
    // the zone onto it (killing void slivers); clip intersects an overhanging room with the zone
    // (trimming instead of rejecting). Both re-run the strict editability audit and fall back to the
    // pre-fit geometry on failure — e.g. a zone edge diagonal to the room's frame.
    // TODO: ZoneSnapFt = 1.0 buys exactly one room on project-a — re-measure it or retire the knob.
    public double ZoneSnapFt = 1.0;         // room vertex this close to the zone boundary snaps onto it (0 = off)
    public bool ZoneClipEnabled = true;     // a room overhanging the zone is intersected with it, not rejected
    // Clipping a rail-aligned room against the zone MANUFACTURES edges the detector never proposed:
    // where the zone line crosses a projected corner or runs a fraction of a degree off the room's
    // rails, the cut leaves off-frame edges (plus non-right corners), the strict audit refuses
    // them, and the refusal sends the whole room back to die at the scope gate over a sub-1%
    // overhang sliver. Every room entering zone-fit already passed the canonical editability audit,
    // so an off-frame edge in the fitted polygon is fit output by construction — never detector
    // geometry. Squaring replaces such an edge with the two frame-aligned edges of its own axis
    // decomposition, preferring the repair that keeps the room inside the zone, and the FULL
    // strict audit re-judges the squared polygon: input hygiene for the audit, never a relaxation
    // of it. The budget is the DISPLACEMENT the repair introduces (the edge's perpendicular
    // deviation from the frame axis), not the edge's length — a 20 ft zone cut 1 degree off frame
    // moves the boundary 0.35 ft; a genuine 5 ft corner chamfer would move it 3.5 ft and is
    // refused as the geometric statement it is. The default equals ZoneSnapFt: squaring licenses
    // exactly the motion this stage already licenses for snapping, no more. Swept 1.0/1.5/2.5 on
    // the 2026-08-16 bins: board-identical, so the tightest value that achieves the effect wins.
    // 0 disables.
    public double ZoneClipSquareFt = 1.0;   // max boundary displacement a squaring repair may introduce
    // ---- Ink-backing acceptance gate (TakeoffPromotion ink-backing stage) ----
    // Teal must mean trustworthy: an accepted room's boundary must actually stand on wall ink.
    // Samples near the zone edge are exempt (zone is authority, not evidence), so a room whose
    // remaining boundary is mostly unbacked — the signature of seal-manufactured partitions in
    // ink-starved zones — is held instead of accepted. 0 disarms.
    public double InkBackedAcceptMin = 0.5;    // minimum backed fraction of non-zone-edge boundary
    public double InkBackedZoneEdgeExemptFt = 1.0; // boundary samples this close to the zone edge don't count
    // ---- Per-zone adaptive policy (ZonePolicy.cs) ----
    // On: a zone's census + raw partition may override the knobs above for that zone alone, and
    // every deviation is reported into report.json. The seam is pure and fully attributed via
    // adaptedKnobs, but it currently carries NO live rules: the sparse-wall absorb rule and its
    // SparseWall* knobs were falsified at the 2.5 ft drift budget (measured -6 rooms; DECISIONS
    // 2026-08-14) and their keying signal, inkRatio, was falsified as a discriminator on
    // framing-clean bins (DECISIONS 2026-08-16); both deleted 2026-08-16. The earned successor
    // keys on ZoneCensus.EdgeBandInkFraction (attic-scoped, round-2 slate).
    public bool AdaptivePolicy = false;
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
    // True once TakeoffPromotion has closed this result: every surviving ROOM is accepted (held
    // rooms were moved to Rejected residues) and ToTsv persists that disposition as an explicit
    // ROOM column instead of leaving it as a convention readers must know. Raw detector output
    // stays false — its rooms have no disposition yet, and its TSV honestly omits the column.
    public bool DispositionsResolved;

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
        // Disposition column (SHIMS.md #3 close): a promoted TSV says "accepted" on every ROOM
        // line outright. Held rooms are the Rejected residues below — that mapping is the
        // persisted contract (ZonePromotionDiagnostics counts HeldRooms exactly that way), not a
        // renderer convention. A 7-column ROOM line means the package predates the column or is
        // raw detector output: disposition unknown, and readers must not assume accepted.
        string disposition = this.DispositionsResolved ? "\taccepted" : "";
        foreach (var r in this.Rooms)
        {
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
        string.Join("|", p.Select(v => v[0].ToString("F6", CultureInfo.InvariantCulture) + ";" + v[1].ToString("F6", CultureInfo.InvariantCulture)));
}
