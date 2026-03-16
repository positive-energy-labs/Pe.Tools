using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Json.SchemaProviders;

public static class OptionContextKeys {
    public const string SelectedFamilyNames = "SelectedFamilyNames";
    public const string SelectedCategoryName = "SelectedCategoryName";
    public const string CategoryName = "CategoryName";
    public const string TagFamilyName = "TagFamilyName";

    public static bool IsContextKey(string key) =>
        string.Equals(key, SelectedFamilyNames, StringComparison.Ordinal) ||
        string.Equals(key, SelectedCategoryName, StringComparison.Ordinal);
}
