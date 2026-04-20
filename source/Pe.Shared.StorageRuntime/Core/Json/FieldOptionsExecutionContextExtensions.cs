using Pe.Shared.StorageRuntime.Json.FieldOptions;

namespace Pe.Shared.StorageRuntime.Core.Json;

public static class FieldOptionsExecutionContextExtensions {
    public static Document? GetActiveDocument(this FieldOptionsExecutionContext context) =>
        context.GetActiveDocument<Document>();
}