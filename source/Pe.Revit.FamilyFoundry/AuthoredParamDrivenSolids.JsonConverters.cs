using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace Pe.Revit.FamilyFoundry;

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
                .OfType<string>()
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.Trim())
                .ToList();
            return new PlanePairOrInlineSpanSpec { PlaneRefs = refs };
        }

        if (token is JObject obj) {
            return new PlanePairOrInlineSpanSpec { InlineSpan = obj.ToObject<AuthoredSpanSpec>(serializer) };
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
            return new PlaneRefOrInlinePlaneSpec { PlaneRef = token.Value<string>()?.Trim() };
        }

        if (token is JObject obj) {
            if (obj.TryGetValue(nameof(AuthoredNamedPlaneSpec.Name), StringComparison.OrdinalIgnoreCase, out _)) {
                return new PlaneRefOrInlinePlaneSpec { InlinePlane = obj.ToObject<AuthoredNamedPlaneSpec>(serializer) };
            }

            return new PlaneRefOrInlinePlaneSpec { EndOffset = obj.ToObject<AuthoredEndOffsetPlaneSpec>(serializer) };
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