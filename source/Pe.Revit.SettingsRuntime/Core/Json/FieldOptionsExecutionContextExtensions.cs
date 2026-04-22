using Pe.Revit.SettingsRuntime.Core.Json.FieldOptions;

namespace Pe.Revit.SettingsRuntime.Core.Json;

public static class FieldOptionsExecutionContextExtensions {
    public static Document? GetActiveDocument(this FieldOptionsExecutionContext context) =>
        context.GetActiveDocument<Document>();
}