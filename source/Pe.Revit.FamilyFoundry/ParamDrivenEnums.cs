using Newtonsoft.Json;
using Newtonsoft.Json.Converters;

namespace Pe.Revit.FamilyFoundry;

[JsonConverter(typeof(StringEnumConverter))]
public enum ParamDrivenFamilyFrameKind {
    NonHosted
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
