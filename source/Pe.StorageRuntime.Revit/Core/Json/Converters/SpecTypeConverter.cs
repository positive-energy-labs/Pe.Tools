using Newtonsoft.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.Converters;

public class SpecTypeConverter : JsonConverter<ForgeTypeId> {
    private static readonly Lazy<Dictionary<string, ForgeTypeId>> LabelMap =
        new(() => SpecNamesProvider.GetLabelToForgeMap());

    public override void WriteJson(JsonWriter writer, ForgeTypeId? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        try {
            var label = value.ToLabel();
            var discipline = GetParentheticDiscipline(value);
            writer.WriteValue($"{label}{discipline}");
        } catch {
            writer.WriteValue(value.TypeId);
        }
    }

    private static string GetParentheticDiscipline(ForgeTypeId spec) {
        if (!UnitUtils.IsMeasurableSpec(spec))
            return string.Empty;
        var disciplineId = UnitUtils.GetDiscipline(spec);
        var disciplineLabel = LabelUtils.GetLabelForDiscipline(disciplineId);
        return !string.IsNullOrEmpty(disciplineLabel) ? $" ({disciplineLabel})" : string.Empty;
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

        if (LabelMap.Value.TryGetValue(input, out var forgeTypeId))
            return forgeTypeId;

        if (input.StartsWith("autodesk.", StringComparison.OrdinalIgnoreCase))
            return new ForgeTypeId(input);

        return null;
    }
}