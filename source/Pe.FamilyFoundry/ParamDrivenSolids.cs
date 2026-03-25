using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
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

    [Description("Semantic connectors with owned stub geometry.")]
    public List<ParamDrivenConnectorSpec> Connectors { get; init; } = [];

    public bool Enabled { get; init; } = true;
}

public class ParamDrivenSolidsSnapshot {
    public SnapshotSource Source { get; set; }
    public List<ParamDrivenRectangleSpec> Rectangles { get; set; } = [];
    public List<ParamDrivenCylinderSpec> Cylinders { get; set; } = [];
    public List<ParamDrivenConnectorSpec> Connectors { get; set; } = [];
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

public sealed class ParamDrivenConnectorSpec {
    public string Name { get; init; } = string.Empty;

    [JsonConverter(typeof(StringEnumConverter))]
    public ParamDrivenConnectorDomain Domain { get; init; }

    public ConnectorHostSpec Host { get; init; } = new();
    public ConnectorStubGeometrySpec Geometry { get; init; } = new();
    public ConnectorParameterBindingsSpec Bindings { get; init; } = new();
    public ConnectorDomainConfigSpec Config { get; init; } = new();
    public InferenceInfo? Inference { get; init; }
}

public sealed class ConnectorHostSpec {
    public string SketchPlane { get; init; } = string.Empty;
    public AxisConstraintSpec Depth { get; init; } = new();
}

public sealed class ConnectorStubGeometrySpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public ParamDrivenConnectorProfile Profile { get; init; }

    public AxisConstraintSpec Width { get; init; } = new();
    public AxisConstraintSpec Length { get; init; } = new();
    public AxisConstraintSpec Diameter { get; init; } = new();

    [Description("Required for round stub geometry so the diameter can be centered and roundtripped.")]
    public string CenterLeftRightPlane { get; init; } = string.Empty;

    [Description("Required for round stub geometry so the diameter can be centered and roundtripped.")]
    public string CenterFrontBackPlane { get; init; } = string.Empty;

    public bool IsSolid { get; init; } = true;
}

public sealed class ConnectorParameterBindingsSpec {
    public List<ConnectorParameterBindingSpec> Parameters { get; init; } = [];
}

public sealed class ConnectorParameterBindingSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public ConnectorParameterKey Target { get; init; }

    public string SourceParameter { get; init; } = string.Empty;
}

public sealed class ConnectorDomainConfigSpec {
    public DuctConnectorConfigSpec? Duct { get; init; }
    public PipeConnectorConfigSpec? Pipe { get; init; }
    public ElectricalConnectorConfigSpec? Electrical { get; init; }
}

public sealed class DuctConnectorConfigSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public DuctSystemType SystemType { get; init; } = DuctSystemType.SupplyAir;

    [JsonConverter(typeof(StringEnumConverter))]
    public DuctFlowConfigurationType FlowConfiguration { get; init; } = DuctFlowConfigurationType.Preset;

    [JsonConverter(typeof(StringEnumConverter))]
    public FlowDirectionType FlowDirection { get; init; } = FlowDirectionType.Out;

    [JsonConverter(typeof(StringEnumConverter))]
    public DuctLossMethodType LossMethod { get; init; } = DuctLossMethodType.NotDefined;
}

public sealed class PipeConnectorConfigSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public PipeSystemType SystemType { get; init; } = PipeSystemType.DomesticColdWater;
}

public sealed class ElectricalConnectorConfigSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public ElectricalSystemType SystemType { get; init; } = ElectricalSystemType.PowerBalanced;
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

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamDrivenConnectorDomain {
    Duct,
    Pipe,
    Electrical
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamDrivenConnectorProfile {
    Round,
    Rectangular
}

[JsonConverter(typeof(StringEnumConverter))]
public enum ConnectorParameterKey {
    Voltage,
    NumberOfPoles,
    ApparentPower,
    MinimumCircuitAmpacity
}
