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
public sealed class TakeoffOptions
{
    public string LevelNameContains = "";   // matched against host Level.Name
    public double CellFt = 0.25;            // grid resolution; 0.25 resolves stud walls
    public double MinSqft = 40;             // reject smaller regions
    public double MinHeadroomFt = 6.0;      // walkable = ceiling - floor >= this (kills eaves)
    public double FloorTolFt = 1.5;         // floor must sit within +/- this of level plane
    public double GapSealFt = 1.0;          // morphological close on the ink — HAIRLINE bridging
                                            // only. Projection ink is continuous (Revit draws cut
                                            // lines unbroken; doors seal via the header band), so
                                            // the old slicing-era 4.2 ft is obsolete here and
                                            // actively harmful: a fat close rounds every concave
                                            // room corner and shrinks rooms (post-port regression,
                                            // user-caught 2026-07-06).
    public double MinCeilingFrac = 0.35;    // region gate: fraction of cells that must have a
                                            // real ceiling (headroom >= MinHeadroomFt). Kills
                                            // open-to-sky courtyards/terraces at REGION level —
                                            // ceiling data is too patchy at framing stage to be
                                            // a per-cell boundary (see Detector header).
    public double KneeBandFt = 4.0;         // seed band A: catches knee walls + under-window studs
    public double HeaderBandFt = 8.5;       // seed band B: ABOVE door/window heads, where framing
                                            // is continuous = geometric door sealing. Estates run
                                            // 10 ft ceilings / 8 ft heads; 6'8"-head stock is ~7.0.
                                            // Estimate per model: stud-top histogram (plate height)
                                            // minus ~2 ft. Three independent pods converged here.
    public int SeedPixelSize = 6000;        // ImageExportOptions.PixelSize for seed exports
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
}

public sealed class TakeoffResult
{
    public string LevelName = "";
    public double LevelElevation;           // ProjectElevation (internal origin)
    public List<RoomResult> Rooms = new();
    public double TotalSqft;
    public string? SeedViewA, SeedViewB;    // names of the stripped seed views (until cleanup)
    public string? EvidenceView;            // rainbow view name (after Annotate)

    // Tab-separated payload; full precision matters — F6 rounding flipped geometric tie-breaks
    // and changed room counts in round 1. Never serialize detection geometry at display precision.
    public string ToTsv()
    {
        var ic = CultureInfo.InvariantCulture;
        var sb = new StringBuilder();
        sb.AppendLine($"META\tlevel\t{this.LevelName}\nMETA\telev\t{this.LevelElevation.ToString("F6", ic)}\nMETA\trooms\t{this.Rooms.Count}\nMETA\ttotalSqft\t{this.TotalSqft.ToString("F1", ic)}");
        foreach (var r in this.Rooms)
        {
            sb.AppendLine($"ROOM\t{r.Id}\t{r.RawSqft.ToString("F1", ic)}\t{r.PerimeterFt.ToString("F1", ic)}\t{r.LabelX.ToString("F6", ic)}\t{r.LabelY.ToString("F6", ic)}\t{r.MeanCeilingFt.ToString("F2", ic)}");
            sb.AppendLine($"POLY\t{r.Id}\touter\t{PolyStr(r.Polygon)}");
            foreach (var h in r.Holes) sb.AppendLine($"POLY\t{r.Id}\thole\t{PolyStr(h)}");
        }
        return sb.ToString();
    }

    private static string PolyStr(List<double[]> p) =>
        string.Join("|", p.Select(v => v[0].ToString("F6", CultureInfo.InvariantCulture) + ";" + v[1].ToString("F6", CultureInfo.InvariantCulture)));
}
