using Pe.Shared.Codegen;

namespace Pe.Revit.SettingsRuntime.Json.SchemaDefinitions;

[ExportTsSchema]
public static class SchemaDatasetIds {
    public const string ParameterCatalog = "parameterCatalog";
    public const string LoadedFamiliesCatalog = "loadedFamiliesCatalog";
}

[ExportTsSchema]
public static class SchemaProjectionKeys {
    public const string FamilyParameterNames = "familyParameterNames";
    public const string FamilyNames = "familyNames";
    public const string CategoryNames = "categoryNames";
}

