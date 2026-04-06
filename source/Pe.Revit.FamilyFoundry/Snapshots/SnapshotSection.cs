namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Indicates where snapshot data was collected from.
/// </summary>
public enum SnapshotSource {
    /// <summary>Data collected from project document (faster for parameters)</summary>
    Project,

    /// <summary>Data collected from family document (for ref planes/dims)</summary>
    FamilyDoc
}

/// <summary>
///     Generic wrapper for snapshot data sections.
///     Tracks the source document and collection timestamp.
/// </summary>
public class SnapshotSection<T> {
    public SnapshotSource Source { get; init; }
    public List<T> Data { get; set; } = [];
    public DateTime CollectedAt { get; init; } = DateTime.Now;

    /// <summary>
    ///     Indicates the collector produced partial/incomplete data.
    ///     When true, subsequent collectors may replace this section with complete data.
    /// </summary>
    public bool IsPartial { get; init; }
}