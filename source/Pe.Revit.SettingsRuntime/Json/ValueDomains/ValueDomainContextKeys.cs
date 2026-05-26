namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public static class ValueDomainContextKeys {
    public const string SelectedFamilyNames = "SelectedFamilyNames";
    public const string SelectedCategoryName = "SelectedCategoryName";
    public const string CategoryName = "CategoryName";
    public const string TagFamilyName = "TagFamilyName";
    public const string UnitTypeId = "UnitTypeId";

    public static bool IsContextKey(string key) =>
        string.Equals(key, SelectedFamilyNames, StringComparison.Ordinal) ||
        string.Equals(key, SelectedCategoryName, StringComparison.Ordinal) ||
        string.Equals(key, CategoryName, StringComparison.Ordinal) ||
        string.Equals(key, TagFamilyName, StringComparison.Ordinal) ||
        string.Equals(key, UnitTypeId, StringComparison.Ordinal);
}
