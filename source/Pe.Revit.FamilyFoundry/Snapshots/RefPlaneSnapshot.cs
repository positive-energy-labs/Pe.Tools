namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Snapshot data for captured reference-plane constraints.
/// </summary>
public class RefPlaneSnapshot {
    public SnapshotSource Source { get; set; }
    public List<MirrorConstraintSnapshot> MirrorConstraintSnapshots { get; set; } = [];
    public List<OffsetConstraintSnapshot> OffsetConstraintSnapshots { get; set; } = [];
}