using Newtonsoft.Json;
using Pe.Global.Services.Document;

namespace Pe.Global.Services.Storage.Core.Json.Converters;

/// <summary>
///     JSON converter for Category that serializes to/from category names.
///     For writing: converts Category to its name (e.g., "Doors", "Windows", "Structural Columns")
///     For reading: finds matching Category in the active document by name.
///     Throws if category not found or no document is active (fail-fast for predictable settings state).
///     Example JSON serialization:
///     <code>   
/// {
///   "FamilyCategory": "Doors"
/// }
/// </code>
/// </summary>
public class CategoryConverter : JsonConverter<Category> {
    public override void WriteJson(JsonWriter writer, Category? value, JsonSerializer serializer) {
        if (value == null) {
            writer.WriteNull();
            return;
        }

        // Write category name as string
        writer.WriteValue(value.Name);
    }

    public override Category? ReadJson(JsonReader reader,
        Type objectType,
        Category? existingValue,
        bool hasExistingValue,
        JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.Null) return null;

        var categoryName = reader.Value?.ToString();
        if (string.IsNullOrWhiteSpace(categoryName))
            throw new JsonSerializationException("Category name cannot be null or empty.");

        var doc = DocumentManager.GetActiveDocument()
                  ?? throw new JsonSerializationException("Cannot deserialize Category: no active Revit document.");

        // Search through categories to find matching name
        foreach (Category cat in doc.Settings.Categories) {
            if (cat.Name.Equals(categoryName, StringComparison.OrdinalIgnoreCase))
                return cat;
        }

        throw new JsonSerializationException(
            $"Category '{categoryName}' not found in the active document.");
    }
}