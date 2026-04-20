using Newtonsoft.Json;
using System.ComponentModel;

namespace Pe.Revit.FamilyFoundry.Plans;

public sealed class ParamDrivenPlanesAndDimsPlan : IOperationSettings {
    [Description("Resolved symmetric plane-pair constraints derived from ParamDrivenSolids.")]
    public List<SymmetricPlanePairSpec> SymmetricPairs { get; init; } = [];

    [Description("Resolved offset plane constraints derived from ParamDrivenSolids.")]
    public List<OffsetPlaneConstraintSpec> Offsets { get; init; } = [];

    public bool Enabled { get; init; } = true;
}

public sealed class SymmetricPlanePairSpec {
    public string OwnerName { get; init; } = string.Empty;
    public string PlaneNameBase { get; init; } = string.Empty;
    public string CenterPlaneName { get; init; } = string.Empty;
    public string NegativePlaneName { get; init; } = string.Empty;
    public string PositivePlaneName { get; init; } = string.Empty;
    public string? Parameter { get; init; }

    [JsonIgnore] public LengthDriverSpec Driver { get; init; } = LengthDriverSpec.None;

    public RpStrength Strength { get; init; } = RpStrength.NotARef;
}

public sealed class OffsetPlaneConstraintSpec {
    public string OwnerName { get; init; } = string.Empty;
    public string PlaneName { get; init; } = string.Empty;
    public string AnchorPlaneName { get; init; } = string.Empty;
    public OffsetDirection Direction { get; init; }
    public string? Parameter { get; init; }

    [JsonIgnore] public LengthDriverSpec Driver { get; init; } = LengthDriverSpec.None;

    public RpStrength Strength { get; init; } = RpStrength.NotARef;
}