using Newtonsoft.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.Global.Services.Storage.Core.Json.Converters;

/// <summary>
///     JSON converter for ForgeTypeId properties that represent group types (property groups).
///     For writing: converts ForgeTypeId to display name (e.g., "Dimensions", "Constraints")
///     For reading: attempts to find matching ForgeTypeId from known GroupTypeId constants.
///     Special case: "Other" maps to an empty ForgeTypeId (new ForgeTypeId("")).
/// </summary>
public class GroupTypeConverter : JsonConverter<ForgeTypeId> {
    private static readonly Lazy<Dictionary<string, ForgeTypeId>> _labelMap =
        new(PropertyGroupNamesProvider.GetLabelForgeMap());

    public override void WriteJson(JsonWriter writer, ForgeTypeId? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        // Special case: Empty ForgeTypeId represents "Other" in Revit UI
        if (string.IsNullOrEmpty(value.TypeId)) {
            writer.WriteValue("Other");
            return;
        }

        // Get human-readable label for group type
        try {
            var label = value.ToLabel();
            writer.WriteValue(label);
        } catch {
            writer.WriteValue(value.TypeId);
        }
    }

    public override ForgeTypeId? ReadJson(JsonReader reader,
        Type objectType,
        ForgeTypeId? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.Null) return null;

        var input = reader.Value?.ToString();
        if (string.IsNullOrWhiteSpace(input)) return null;

        // Special case: "Other" in Revit UI maps to an empty ForgeTypeId
        if (input.Equals("Other", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId("");

        // Try to find by label in group types
        if (_labelMap.Value.TryGetValue(input, out var forgeTypeId)) return forgeTypeId;

        // If not found by label, check if the input is a valid TypeId format
        if (input.StartsWith("autodesk.", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(input);

        // Return null for invalid values (allows property to use default value)
        return null;
    }
}