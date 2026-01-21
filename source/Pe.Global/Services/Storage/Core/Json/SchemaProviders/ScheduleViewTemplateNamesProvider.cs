using Pe.Global.Revit.Lib.Schedules;
using Pe.Global.Services.Document;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;

namespace Pe.Global.Services.Storage.Core.Json.SchemaProviders;

/// <summary>
///     Provides schedule view template names from the active Revit document for JSON schema examples.
///     Used to enable LSP autocomplete for view template name properties.
///     Returns empty list if no document is available (schema generation context).
/// </summary>
public class ScheduleViewTemplateNamesProvider : IOptionsProvider {
    public IEnumerable<string> GetExamples() {
        try {
            var doc = DocumentManager.GetActiveDocument();
            if (doc == null || doc.IsFamilyDocument) return [];

            return ScheduleHelper.GetScheduleViewTemplateNames(doc);
        } catch {
            // No document available or error - no examples, no crash
            return [];
        }
    }
}