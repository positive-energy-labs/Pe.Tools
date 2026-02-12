namespace Pe.FamilyFoundry.Snapshots;

/// <summary>
///     Snapshot data for constrained extrusions.
///     Only canonical, reference-plane-constrained shapes are serialized.
/// </summary>
public class ExtrusionSnapshot {
    public SnapshotSource Source { get; set; }
    public List<ConstrainedRectangleExtrusionSpec> Rectangles { get; set; } = [];
    public List<ConstrainedCircleExtrusionSpec> Circles { get; set; } = [];
}

/// <summary>
///     Canonical constrained rectangle extrusion:
///     two orthogonal reference-plane pairs define the profile bounds.
/// </summary>
public class ConstrainedRectangleExtrusionSpec {
    public string Name { get; init; } = string.Empty;
    public bool IsSolid { get; init; }
    public double StartOffset { get; init; }
    public double EndOffset { get; init; }
    public string SketchPlaneName { get; init; } = string.Empty;

    public string PairAPlane1 { get; init; } = string.Empty;
    public string PairAPlane2 { get; init; } = string.Empty;
    public string PairAParameter { get; init; } = string.Empty;

    public string PairBPlane1 { get; init; } = string.Empty;
    public string PairBPlane2 { get; init; } = string.Empty;
    public string PairBParameter { get; init; } = string.Empty;

    /// <summary>
    ///     Optional canonical height constraint pair.
    ///     When both names are provided, start/end offsets are derived from these planes and
    ///     top/bottom faces are aligned to them after creation.
    /// </summary>
    public string? HeightPlaneBottom { get; init; }
    public string? HeightPlaneTop { get; init; }
    public string? HeightParameter { get; init; }
}

/// <summary>
///     Canonical constrained circle extrusion:
///     two orthogonal reference-plane pairs define a constrained circular profile.
/// </summary>
public class ConstrainedCircleExtrusionSpec {
    public string Name { get; init; } = string.Empty;
    public bool IsSolid { get; init; }
    public double StartOffset { get; init; }
    public double EndOffset { get; init; }
    public string SketchPlaneName { get; init; } = string.Empty;

    public string PairAPlane1 { get; init; } = string.Empty;
    public string PairAPlane2 { get; init; } = string.Empty;
    public string PairAParameter { get; init; } = string.Empty;

    public string PairBPlane1 { get; init; } = string.Empty;
    public string PairBPlane2 { get; init; } = string.Empty;
    public string PairBParameter { get; init; } = string.Empty;
}
