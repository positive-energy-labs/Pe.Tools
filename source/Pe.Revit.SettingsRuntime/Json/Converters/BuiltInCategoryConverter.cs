using Newtonsoft.Json;
using Pe.Revit.SettingsRuntime.Json.ValueDomains;

namespace Pe.Revit.SettingsRuntime.Json.Converters;

/// <summary>
///     JSON converter for BuiltInCategory that serializes to/from user-visible category labels.
/// </summary>
public class BuiltInCategoryConverter : JsonConverter<BuiltInCategory> {
    private static readonly Lazy<Dictionary<string, BuiltInCategory>> LabelMap =
        new(() => CategoryNamesValueDomain.GetLabelToBuiltInCategoryMap());

    public override void WriteJson(JsonWriter writer, BuiltInCategory value, JsonSerializer serializer) {
        if (value == BuiltInCategory.INVALID) {
            writer.WriteNull();
            return;
        }

        writer.WriteValue(CategoryNamesValueDomain.GetLabelForBuiltInCategory(value));
    }

    public override BuiltInCategory ReadJson(
        JsonReader reader,
        Type objectType,
        BuiltInCategory existingValue,
        bool hasExistingValue,
        JsonSerializer serializer
    ) {
        if (reader.TokenType == JsonToken.Null)
            return BuiltInCategory.INVALID;

        var categoryName = reader.Value?.ToString();
        if (string.IsNullOrWhiteSpace(categoryName))
            return BuiltInCategory.INVALID;

        return LabelMap.Value.TryGetValue(categoryName, out var builtInCategory)
            ? builtInCategory
            : BuiltInCategory.INVALID;
    }
}

