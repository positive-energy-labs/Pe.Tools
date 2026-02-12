using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using System.Collections;

namespace Pe.Global.Services.Storage.Core.Json.Converters;

/// <summary>
///     Serializes list children with a uniform key set across all object-like rows.
/// </summary>
public class UniformChildKeysListConverter(string missingValue = "") : JsonConverter {
    public override bool CanRead => false;

    public override bool CanConvert(Type objectType) =>
        typeof(IEnumerable).IsAssignableFrom(objectType) && objectType != typeof(string);

    public override object? ReadJson(
        JsonReader reader,
        Type objectType,
        object? existingValue,
        JsonSerializer serializer) =>
        throw new NotSupportedException($"{nameof(UniformChildKeysListConverter)} is write-only.");

    public override void WriteJson(JsonWriter writer, object? value, JsonSerializer serializer) {
        if (value is null) {
            writer.WriteNull();
            return;
        }

        if (value is not IEnumerable list || value is string) {
            JToken.FromObject(value, serializer).WriteTo(writer);
            return;
        }

        var rows = new List<JObject>();
        var headerOrder = new List<string>();
        var seenHeaders = new HashSet<string>(StringComparer.Ordinal);

        foreach (var row in list) {
            var rowObj = ToJObject(row, serializer);
            rows.Add(rowObj);

            foreach (var prop in rowObj.Properties()) {
                if (seenHeaders.Add(prop.Name))
                    headerOrder.Add(prop.Name);
            }
        }

        var normalized = new JArray();
        foreach (var row in rows) {
            var normalizedRow = new JObject();
            foreach (var key in headerOrder) {
                var token = row.TryGetValue(key, out var existingToken)
                    ? existingToken
                    : new JValue(missingValue);
                normalizedRow.Add(key, token);
            }

            normalized.Add(normalizedRow);
        }

        normalized.WriteTo(writer);
    }

    private static JObject ToJObject(object? row, JsonSerializer serializer) {
        if (row is null) return new JObject();
        if (row is JObject jObject) return (JObject)jObject.DeepClone();

        var token = JToken.FromObject(row, serializer);
        return token as JObject ?? new JObject();
    }
}
