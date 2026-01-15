using Pe.FamilyFoundry.Snapshots;

namespace Pe.FamilyFoundry.Aggregators.Snapshots;

/// <summary>
///     Container for all snapshot data collected from a family.
///     Each section tracks its source (Project vs FamilyDoc) and collection timestamp.
/// </summary>
public class FamilySnapshot {
    public required string FamilyName { get; init; }

    /// <summary>Parameter snapshots with source tracking</summary>
    public SnapshotSection<ParamSnapshot> Parameters { get; set; }

    /// <summary>Reference plane and dimension specs with source tracking</summary>
    public RefPlaneSnapshot RefPlanesAndDims { get; set; }

    // Future sections: Connectors, etc.
}