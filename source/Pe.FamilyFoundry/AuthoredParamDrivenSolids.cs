using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;

namespace Pe.FamilyFoundry;

public sealed class AuthoredParamDrivenSolidsSettings : IOperationSettings {
    [JsonConverter(typeof(StringEnumConverter))]
    public ParamDrivenFamilyFrameKind Frame { get; init; } = ParamDrivenFamilyFrameKind.NonHosted;

    public Dictionary<string, AuthoredPlaneSpec> Planes { get; init; } = new(StringComparer.Ordinal);
    public List<AuthoredSpanSpec> Spans { get; init; } = [];
    public List<AuthoredPrismSpec> Prisms { get; init; } = [];
    public List<AuthoredCylinderSpec> Cylinders { get; init; } = [];
    public List<AuthoredConnectorSpec> Connectors { get; init; } = [];

    [JsonIgnore]
    public bool Enabled { get; init; } = true;

    [JsonIgnore]
    public bool HasContent =>
        this.Planes.Count > 0 ||
        this.Spans.Count > 0 ||
        this.Prisms.Count > 0 ||
        this.Cylinders.Count > 0 ||
        this.Connectors.Count > 0;
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
public sealed class PlanePairOrInlineSpanSpec {
    public IReadOnlyList<string>? PlaneRefs { get; init; }
    public AuthoredSpanSpec? InlineSpan { get; init; }
}

[JsonConverter(typeof(PlaneRefOrInlinePlaneJsonConverter))]
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

internal sealed class PlanePairOrInlineSpanJsonConverter : JsonConverter<PlanePairOrInlineSpanSpec> {
    public override PlanePairOrInlineSpanSpec? ReadJson(
        JsonReader reader,
        Type objectType,
        PlanePairOrInlineSpanSpec? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer
    ) {
        var token = JToken.Load(reader);
        if (token.Type == JTokenType.Null)
            return null;

        if (token is JArray array) {
            var refs = array.Values<string>()
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToList();
            return new PlanePairOrInlineSpanSpec { PlaneRefs = refs };
        }

        if (token is JObject obj) {
            return new PlanePairOrInlineSpanSpec {
                InlineSpan = obj.ToObject<AuthoredSpanSpec>(serializer)
            };
        }

        throw new JsonSerializationException("Expected an array of plane refs or an inline span object.");
    }

    public override void WriteJson(JsonWriter writer, PlanePairOrInlineSpanSpec? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        if (value.PlaneRefs is { Count: > 0 }) {
            serializer.Serialize(writer, value.PlaneRefs);
            return;
        }

        serializer.Serialize(writer, value.InlineSpan);
    }
}

internal sealed class PlaneRefOrInlinePlaneJsonConverter : JsonConverter<PlaneRefOrInlinePlaneSpec> {
    public override PlaneRefOrInlinePlaneSpec? ReadJson(
        JsonReader reader,
        Type objectType,
        PlaneRefOrInlinePlaneSpec? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer
    ) {
        var token = JToken.Load(reader);
        if (token.Type == JTokenType.Null)
            return null;

        if (token.Type == JTokenType.String) {
            return new PlaneRefOrInlinePlaneSpec {
                PlaneRef = token.Value<string>()?.Trim()
            };
        }

        if (token is JObject obj) {
            if (obj.TryGetValue(nameof(AuthoredNamedPlaneSpec.Name), StringComparison.OrdinalIgnoreCase, out _)) {
                return new PlaneRefOrInlinePlaneSpec {
                    InlinePlane = obj.ToObject<AuthoredNamedPlaneSpec>(serializer)
                };
            }

            return new PlaneRefOrInlinePlaneSpec {
                EndOffset = obj.ToObject<AuthoredEndOffsetPlaneSpec>(serializer)
            };
        }

        throw new JsonSerializationException("Expected a plane ref string or an inline plane object.");
    }

    public override void WriteJson(JsonWriter writer, PlaneRefOrInlinePlaneSpec? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        if (!string.IsNullOrWhiteSpace(value.PlaneRef)) {
            writer.WriteValue(value.PlaneRef);
            return;
        }

        if (value.InlinePlane != null) {
            serializer.Serialize(writer, value.InlinePlane);
            return;
        }

        serializer.Serialize(writer, value.EndOffset);
    }
}
