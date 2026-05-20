using Newtonsoft.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;

namespace Pe.Revit.SettingsRuntime.Json.Converters;

public class GroupTypeConverter : JsonConverter<ForgeTypeId> {
    private static readonly Lazy<Dictionary<string, ForgeTypeId>> LabelMap =
        new(() => PropertyGroupNamesValueDomain.GetLabelForgeMap());

    public override void WriteJson(JsonWriter writer, ForgeTypeId? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        if (string.IsNullOrEmpty(value.TypeId)) {
            writer.WriteValue("Other");
            return;
        }

        try {
            var label = RevitLabelCatalog.GetLabelForPropertyGroup(value);
            writer.WriteValue(label);
        } catch {
            writer.WriteValue(value.TypeId);
        }
    }

    public override ForgeTypeId? ReadJson(
        JsonReader reader,
        Type objectType,
        ForgeTypeId? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer
    ) {
        if (reader.TokenType == JsonToken.Null)
            return null;

        var input = reader.Value?.ToString();
        if (string.IsNullOrWhiteSpace(input))
            return null;

        if (input.Equals("Other", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId("");

        if (LabelMap.Value.TryGetValue(input, out var forgeTypeId))
            return forgeTypeId;

        if (input.StartsWith("autodesk.", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(input);

        return null;
    }
}

