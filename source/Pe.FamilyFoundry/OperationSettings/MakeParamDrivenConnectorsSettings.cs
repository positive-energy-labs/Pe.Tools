using Pe.FamilyFoundry.Snapshots;
using System.ComponentModel;

namespace Pe.FamilyFoundry.OperationSettings;

public class MakeParamDrivenConnectorsSettings : IOperationSettings {
    [Description("Compiled connector plans to create with owned stub geometry.")]
    public List<CompiledParamDrivenConnectorSpec> Connectors { get; init; } = [];

    public bool Enabled { get; init; } = true;
}

public sealed class CompiledParamDrivenConnectorSpec {
    public string Name { get; init; } = string.Empty;
    public string StubSolidName { get; init; } = string.Empty;
    public ParamDrivenConnectorDomain Domain { get; init; }
    public ParamDrivenConnectorProfile Profile { get; init; }
    public string HostPlaneName { get; init; } = string.Empty;
    public string HostFacePlaneName { get; init; } = string.Empty;
    public OffsetDirection DepthDirection { get; init; } = OffsetDirection.Positive;
    [Newtonsoft.Json.JsonIgnore]
    public LengthDriverSpec DepthDriver { get; init; } = LengthDriverSpec.None;
    public ConstrainedRectangleExtrusionSpec? RectangularStub { get; init; }
    public ConstrainedCircleExtrusionSpec? RoundStub { get; init; }
    public ConnectorBindingsSpec Bindings { get; init; } = new();
    public ConnectorDomainConfigSpec Config { get; init; } = new();
    public AuthoredConnectorSpec AuthoredSpec { get; init; } = new();
}
