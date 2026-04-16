using Pe.Revit.FamilyFoundry;
using Pe.Revit.FamilyFoundry.Plans;
using Pe.Revit.FamilyFoundry.Snapshots;

namespace Pe.Revit.FamilyFoundry.Snapshots;

/// <summary>
///     Container for all snapshot data collected from a family.
///     Captured fields track provenance when the model needs it.
/// </summary>
public class FamilySnapshot {
    public string FamilyName { get; init; }

    /// <summary>Parameter snapshots with source tracking.</summary>
    public CapturedCollection<ParameterSnapshot> Parameters { get; set; }

    /// <summary>Embedded family lookup tables captured as portable table definitions.</summary>
    public CapturedCollection<LookupTableDefinition> LookupTables { get; set; }

    /// <summary>Reference plane and dimension snapshots with source tracking.</summary>
    public RefPlaneSnapshot RefPlanesAndDims { get; set; }

    /// <summary>Authored solid snapshot used for authoring roundtrips.</summary>
    public AuthoredParamDrivenSolidsSettings ParamDrivenSolids { get; set; }

    // Future captured fields: connectors, etc.
}

