using Autodesk.Revit.DB.Electrical;
using Autodesk.Revit.DB.Mechanical;
using Autodesk.Revit.DB.Plumbing;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.FamilyFoundry;

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

    [JsonConverter(typeof(StringEnumConverter))]
    public FlowDirectionType FlowDirection { get; init; } = FlowDirectionType.Bidirectional;
}

public sealed class ElectricalConnectorConfigSpec {
    [JsonConverter(typeof(StringEnumConverter))]
    public ElectricalSystemType SystemType { get; init; } = ElectricalSystemType.PowerBalanced;
}
