using TypeGen.Core.TypeAnnotations;

namespace Pe.Shared.StorageRuntime.Json.SchemaDefinitions;

[ExportTsClass]
public static class SchemaDatasetIds {
    public const string ParameterCatalog = "parameterCatalog";
    public const string LoadedFamiliesCatalog = "loadedFamiliesCatalog";
}

[ExportTsClass]
public static class SchemaProjectionKeys {
    public const string FamilyParameterNames = "familyParameterNames";
    public const string FamilyNames = "familyNames";
    public const string CategoryNames = "categoryNames";
}

[ExportTsClass]
public static class SchemaInvalidationKeys {
    public const string DocumentChanged = "documentChanged";
}