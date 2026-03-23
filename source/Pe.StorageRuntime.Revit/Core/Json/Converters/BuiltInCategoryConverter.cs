using Newtonsoft.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.Converters;

/// <summary>
///     JSON converter for BuiltInCategory that serializes to/from user-visible category labels.
/// </summary>
public class BuiltInCategoryConverter : JsonConverter<BuiltInCategory> {
    private static readonly Lazy<Dictionary<string, BuiltInCategory>> LabelMap =
        new(() => CategoryNamesProvider.GetLabelToBuiltInCategoryMap());

    public override void WriteJson(JsonWriter writer, BuiltInCategory value, JsonSerializer serializer) {
        if (value == BuiltInCategory.INVALID) {
            writer.WriteNull();
            return;
        }

        writer.WriteValue(CategoryNamesProvider.GetLabelForBuiltInCategory(value));
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