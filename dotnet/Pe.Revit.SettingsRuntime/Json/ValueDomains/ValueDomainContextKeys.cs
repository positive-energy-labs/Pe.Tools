namespace Pe.Revit.SettingsRuntime.Json.ValueDomains;

public static class ValueDomainContextKeys {
    public const string SelectedFamilyNames = "SelectedFamilyNames";
    public const string SelectedCategoryName = "SelectedCategoryName";
    public const string CategoryName = "CategoryName";
    public const string TagFamilyName = "TagFamilyName";
    public const string UnitTypeId = "UnitTypeId";
    public const string CategoryId = "CategoryId";
    public const string ElementUniqueIds = "ElementUniqueIds";
    public const string ParameterScope = "ParameterScope";
    public const string WritableOnly = "WritableOnly";
    public const string StorageType = "StorageType";
    public const string DataTypeId = "DataTypeId";

    public static bool IsContextKey(string key) =>
        string.Equals(key, SelectedFamilyNames, StringComparison.Ordinal) ||
        string.Equals(key, SelectedCategoryName, StringComparison.Ordinal) ||
        string.Equals(key, CategoryName, StringComparison.Ordinal) ||
        string.Equals(key, TagFamilyName, StringComparison.Ordinal) ||
        string.Equals(key, UnitTypeId, StringComparison.Ordinal) ||
        string.Equals(key, CategoryId, StringComparison.Ordinal) ||
        string.Equals(key, ElementUniqueIds, StringComparison.Ordinal) ||
        string.Equals(key, ParameterScope, StringComparison.Ordinal) ||
        string.Equals(key, WritableOnly, StringComparison.Ordinal) ||
        string.Equals(key, StorageType, StringComparison.Ordinal) ||
        string.Equals(key, DataTypeId, StringComparison.Ordinal);
}
