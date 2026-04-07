using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.OperationSettings;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.FamilyFoundry.Aggregators.Snapshots;

/// <summary>
///     Container for all snapshot data collected from a family.
///     Each section tracks its source (Project vs FamilyDoc) and collection timestamp.
/// </summary>
public class FamilySnapshot {
    public string FamilyName { get; init; }

    /// <summary>Parameter snapshots with source tracking</summary>
    public SnapshotSection<ParameterSnapshot> Parameters { get; set; }

    /// <summary>Embedded family lookup tables captured as portable table definitions.</summary>
    public SnapshotSection<LookupTableDefinition> LookupTables { get; set; }

    /// <summary>Reference plane and dimension specs with source tracking</summary>
    public RefPlaneSnapshot RefPlanesAndDims { get; set; }

    /// <summary>Authored solid snapshot used for authoring roundtrips.</summary>
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; set; }

    // Future sections: Connectors, etc.
}
