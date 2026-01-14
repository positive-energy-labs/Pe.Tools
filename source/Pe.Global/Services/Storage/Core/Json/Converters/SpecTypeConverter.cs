using Newtonsoft.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;

namespace Pe.Global.Services.Storage.Core.Json.Converters;

/// <summary>
///     JSON converter for ForgeTypeId properties that represent spec types (data types).
///     For writing: converts ForgeTypeId to display name with discipline (e.g., "Length (Common)")
///     For reading: attempts to find matching ForgeTypeId from known SpecTypeId constants.
/// </summary>
public class SpecTypeConverter : JsonConverter<ForgeTypeId> {
    private static readonly Lazy<Dictionary<string, ForgeTypeId>> _labelMap =
        new(SpecNamesProvider.GetLabelToForgeMap());

    public override void WriteJson(JsonWriter writer, ForgeTypeId? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        // Try to get a human-readable label with discipline
        try {
            var label = value.ToLabel();
            var discipline = GetParentheticDiscipline(value);
            writer.WriteValue($"{label}{discipline}");
        } catch {
            writer.WriteValue(value.TypeId);
        }
    }

    private static string GetParentheticDiscipline(ForgeTypeId spec) {
        if (!UnitUtils.IsMeasurableSpec(spec)) return string.Empty;
        var disciplineId = UnitUtils.GetDiscipline(spec);
        var disciplineLabel = LabelUtils.GetLabelForDiscipline(disciplineId);
        return !string.IsNullOrEmpty(disciplineLabel) ? $" ({disciplineLabel})" : string.Empty;
    }

    public override ForgeTypeId? ReadJson(JsonReader reader,
        Type objectType,
        ForgeTypeId? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.Null) return null;

        var input = reader.Value?.ToString();
        if (string.IsNullOrWhiteSpace(input)) return null;

        // Try to find by label in spec types
        if (_labelMap.Value.TryGetValue(input, out var forgeTypeId)) return forgeTypeId;

        // If not found by label, check if the input is a valid TypeId format
        if (input.StartsWith("autodesk.", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(input);

        // Return null for invalid values (allows property to use default value)
        return null;
    }
}