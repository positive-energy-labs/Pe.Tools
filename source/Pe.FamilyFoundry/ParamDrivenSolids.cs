using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.FamilyFoundry.Snapshots;
using System.ComponentModel;

namespace Pe.FamilyFoundry;

public class ParamDrivenSolidsSettings : IOperationSettings {
    [Description("Semantic rectangle solids to create.")]
    public List<ParamDrivenRectangleSpec> Rectangles { get; init; } = [];

    [Description("Semantic cylinder solids to create.")]
    public List<ParamDrivenCylinderSpec> Cylinders { get; init; } = [];

    public bool Enabled { get; init; } = true;
}

public class ParamDrivenSolidsSnapshot {
    public SnapshotSource Source { get; set; }
    public List<ParamDrivenRectangleSpec> Rectangles { get; set; } = [];
    public List<ParamDrivenCylinderSpec> Cylinders { get; set; } = [];
}

public abstract class ParamDrivenSolidSpec {
    public string Name { get; init; } = string.Empty;
    public bool IsSolid { get; init; } = true;
    public SketchTargetSpec Sketch { get; init; } = new();
    public InferenceInfo? Inference { get; init; }
}

public sealed class ParamDrivenRectangleSpec : ParamDrivenSolidSpec {
    public AxisConstraintSpec Width { get; init; } = new();
    public AxisConstraintSpec Length { get; init; } = new();
    public AxisConstraintSpec Height { get; init; } = new();
}

public sealed class ParamDrivenCylinderSpec : ParamDrivenSolidSpec {
    [Description("Reference plane that constrains the cylinder center in the family left/right axis.")]
    public string CenterLeftRightPlane { get; init; } = string.Empty;

    [Description("Reference plane that constrains the cylinder center in the family front/back axis.")]
    public string CenterFrontBackPlane { get; init; } = string.Empty;

    public AxisConstraintSpec Diameter { get; init; } = new();
    public AxisConstraintSpec Height { get; init; } = new();
}

public sealed class SketchTargetSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public SketchTargetKind Kind { get; init; } = SketchTargetKind.ReferencePlane;

    public string Plane { get; init; } = string.Empty;
}

public sealed class AxisConstraintSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public AxisConstraintMode Mode { get; init; }

    public string Parameter { get; init; } = string.Empty;
    public string CenterAnchor { get; init; } = string.Empty;
    public string Anchor { get; init; } = string.Empty;

    [JsonConverter(typeof(StringEnumConverter))]
    public OffsetDirection Direction { get; init; } = OffsetDirection.Positive;

    public string PlaneNameBase { get; init; } = string.Empty;

    [JsonConverter(typeof(StringEnumConverter))]
    public RpStrength Strength { get; init; } = RpStrength.NotARef;

    public InferenceInfo? Inference { get; init; }
}

public sealed class InferenceInfo {
    [JsonConverter(typeof(StringEnumConverter))]
    public InferenceStatus Status { get; init; } = InferenceStatus.Exact;

    public List<string> Warnings { get; init; } = [];
}

[JsonConverter(typeof(StringEnumConverter))]
public enum AxisConstraintMode {
    Mirror,
    Offset
}

[JsonConverter(typeof(StringEnumConverter))]
public enum SketchTargetKind {
    ReferencePlane
}

[JsonConverter(typeof(StringEnumConverter))]
public enum InferenceStatus {
    Exact,
    Inferred,
    Ambiguous
}
