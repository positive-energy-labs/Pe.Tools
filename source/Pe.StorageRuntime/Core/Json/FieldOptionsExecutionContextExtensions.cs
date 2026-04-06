using Pe.StorageRuntime.Json.FieldOptions;

namespace Pe.StorageRuntime.Revit.Core.Json;

public static class FieldOptionsExecutionContextExtensions {
    public static Autodesk.Revit.DB.Document? GetActiveDocument(this FieldOptionsExecutionContext context) =>
        context.GetActiveDocument<Autodesk.Revit.DB.Document>();
}
