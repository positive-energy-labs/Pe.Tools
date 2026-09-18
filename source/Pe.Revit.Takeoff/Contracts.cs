namespace Pe.Revit.Takeoff;

// Room-takeoff contracts: the per-room payload the RHVAC / OpenStudio exporter consumes (sqft,
// perimeter, wall segments, interior label point, polygon, mean ceiling height). Detection must
// not depend on native Room names — architects place Rooms in only ~1/4-1/3 of spaces, so names
// are matched on later by containment. See docs/features/takeoffs/rhvac-and-mj-reference.md.

public enum TakeoffSource { Detector, Native }
public enum ResidueReason { Border, Crumb, Rejected, Excluded, Held, Void }

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
