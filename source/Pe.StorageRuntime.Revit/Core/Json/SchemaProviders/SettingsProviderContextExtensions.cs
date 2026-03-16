using Pe.StorageRuntime.Json.SchemaProviders;

namespace Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;

public static class SettingsProviderContextExtensions {
    public static Autodesk.Revit.DB.Document? GetActiveDocument(this SettingsProviderContext context) =>
        context.GetActiveDocument<Autodesk.Revit.DB.Document>();
}
