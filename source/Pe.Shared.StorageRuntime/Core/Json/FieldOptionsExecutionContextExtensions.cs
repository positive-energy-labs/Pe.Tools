using Pe.Shared.StorageRuntime.Json.FieldOptions;

namespace Pe.Shared.StorageRuntime.Core.Json;

public static class FieldOptionsExecutionContextExtensions {
    public static Autodesk.Revit.DB.Document? GetActiveDocument(this FieldOptionsExecutionContext context) =>
        context.GetActiveDocument<Autodesk.Revit.DB.Document>();
}
