using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.SettingsRuntime.Json;

namespace Pe.Revit.FamilyFoundry;

public sealed class AuthoredParamDrivenSolidsSettings : IOperationSettings {
    [JsonConverter(typeof(StringEnumConverter))]
    public ParamDrivenFamilyFrameKind Frame { get; init; } = ParamDrivenFamilyFrameKind.NonHosted;

    public Dictionary<string, AuthoredPlaneSpec> Planes { get; init; } = new(StringComparer.Ordinal);
    public List<AuthoredSpanSpec> Spans { get; init; } = [];
    public List<AuthoredPrismSpec> Prisms { get; init; } = [];
    public List<AuthoredCylinderSpec> Cylinders { get; init; } = [];
    public List<AuthoredConnectorSpec> Connectors { get; init; } = [];

    [JsonIgnore]
    public bool HasContent =>
        this.Planes.Count > 0 ||
        this.Spans.Count > 0 ||
        this.Prisms.Count > 0 ||
        this.Cylinders.Count > 0 ||
        this.Connectors.Count > 0;

    [JsonIgnore] public bool Enabled { get; init; } = true;
}

public class AuthoredPlaneSpec {
    public string From { get; init; } = string.Empty;
    public string By { get; init; } = string.Empty;
    public string Dir { get; init; } = string.Empty;
}

public sealed class AuthoredNamedPlaneSpec : AuthoredPlaneSpec {
    public string Name { get; init; } = string.Empty;
}

public sealed class AuthoredSpanSpec {
    public string About { get; init; } = string.Empty;
    public string By { get; init; } = string.Empty;
    public string Negative { get; init; } = string.Empty;
    public string Positive { get; init; } = string.Empty;
}

[JsonConverter(typeof(PlanePairOrInlineSpanJsonConverter))]
[JsonTypeSchemaBinding(typeof(PlanePairOrInlineSpanSchemaBinding))]
public sealed class PlanePairOrInlineSpanSpec {
    public IReadOnlyList<string>? PlaneRefs { get; init; }
    public AuthoredSpanSpec? InlineSpan { get; init; }
}

[JsonConverter(typeof(PlaneRefOrInlinePlaneJsonConverter))]
[JsonTypeSchemaBinding(typeof(PlaneRefOrInlinePlaneSchemaBinding))]
public sealed class PlaneRefOrInlinePlaneSpec {
    public string? PlaneRef { get; init; }
    public AuthoredNamedPlaneSpec? InlinePlane { get; init; }
    public AuthoredEndOffsetPlaneSpec? EndOffset { get; init; }
}

public abstract class AuthoredSolidSpec {
    public string Name { get; init; } = string.Empty;
    public bool IsSolid { get; init; } = true;
    public string On { get; init; } = string.Empty;
}

public sealed class AuthoredPrismSpec : AuthoredSolidSpec {
    public PlanePairOrInlineSpanSpec Width { get; init; } = new();
    public PlanePairOrInlineSpanSpec Length { get; init; } = new();
    public PlaneRefOrInlinePlaneSpec Height { get; init; } = new();
}

public sealed class AuthoredCenterMeasureSpec {
    public string About { get; init; } = string.Empty;
    public string By { get; init; } = string.Empty;
}

public sealed class AuthoredMeasureSpec {
    public string By { get; init; } = string.Empty;
}

public sealed class AuthoredEndOffsetPlaneSpec {
    public string By { get; init; } = string.Empty;
    public string Dir { get; init; } = string.Empty;
}

public sealed class AuthoredCylinderSpec : AuthoredSolidSpec {
    public List<string> Center { get; init; } = [];
    public AuthoredMeasureSpec Diameter { get; init; } = new();
    public PlaneRefOrInlinePlaneSpec Height { get; init; } = new();
}

public sealed class AuthoredDepthSpec {
    public string By { get; init; } = string.Empty;
    public string Dir { get; init; } = string.Empty;
}

public sealed class AuthoredRoundConnectorGeometrySpec {
    public List<string> Center { get; init; } = [];
    public AuthoredMeasureSpec Diameter { get; init; } = new();
}

public sealed class AuthoredRectConnectorGeometrySpec {
    public List<string> Center { get; init; } = [];
    public AuthoredCenterMeasureSpec Width { get; init; } = new();
    public AuthoredCenterMeasureSpec Length { get; init; } = new();
}

public sealed class AuthoredConnectorConfigSpec {
    public string SystemType { get; init; } = string.Empty;
    public string FlowConfiguration { get; init; } = string.Empty;
    public string FlowDirection { get; init; } = string.Empty;
    public string LossMethod { get; init; } = string.Empty;
}

public sealed class AuthoredConnectorSpec {
    public string Name { get; init; } = string.Empty;

    // FamilyModel's universal frame is lowered through this legacy model without widening the old JSON surface.
    // These are compiler-only axes; persisted truth remains the portable family.json.
    [JsonIgnore] public string? FrameNormal { get; init; }
    [JsonIgnore] public string? FrameUp { get; init; }

    [JsonConverter(typeof(StringEnumConverter))]
    public ParamDrivenConnectorDomain Domain { get; init; }

    public string Face { get; init; } = string.Empty;
    public AuthoredDepthSpec Depth { get; init; } = new();
    public bool IsSolid { get; init; } = true;
    public AuthoredRoundConnectorGeometrySpec? Round { get; init; }
    public AuthoredRectConnectorGeometrySpec? Rect { get; init; }
    public ConnectorBindingsSpec Bindings { get; init; } = new();
    public AuthoredConnectorConfigSpec Config { get; init; } = new();
}
