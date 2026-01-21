using Autodesk.Revit.ApplicationServices;
using Autodesk.Revit.DB.Events;
using Microsoft.AspNetCore.SignalR;
using Pe.Global.Services.SignalR.Hubs;
using Serilog;

namespace Pe.Global.Services.SignalR;

/// <summary>
///     Monitors Revit document changes and notifies connected SignalR clients.
/// </summary>
public class DocumentStateNotifier : IDisposable {
    private readonly IHubContext<SchemaHub> _schemaHub;
    private readonly Application _app;

    /// <summary>
    ///     Categories that, when modified, should trigger an examples refresh.
    /// </summary>
    private static readonly BuiltInCategory[] RelevantCategories = [
        BuiltInCategory.OST_GenericAnnotation,
        BuiltInCategory.OST_MultiCategoryTags,
        BuiltInCategory.OST_MechanicalEquipmentTags,
        BuiltInCategory.OST_ElectricalEquipmentTags,
        BuiltInCategory.OST_PipeAccessoryTags,
        BuiltInCategory.OST_DuctAccessoryTags
        // Add more tag categories as needed
    ];

    public DocumentStateNotifier(IHubContext<SchemaHub> schemaHub, Application app) {
        this._schemaHub = schemaHub;
        this._app = app;

        // Subscribe to Revit events
        this._app.DocumentChanged += this.OnDocumentChanged;
        this._app.DocumentOpened += this.OnDocumentOpened;
        this._app.DocumentClosed += this.OnDocumentClosed;
    }

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        try {
            var doc = e.Document;
            var docInfo = new DocumentInfo(doc.Title, doc.PathName, doc.IsModified);

            // Notify clients about new document and invalidate examples
            _ = this._schemaHub.Clients.All.SendAsync("DocumentChanged",
                new DocumentChangedNotification(docInfo, true));

            Log.Debug("DocumentStateNotifier: Document opened - {Title}", doc.Title);
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentOpened");
        }
    }

    private void OnDocumentClosed(object? sender, DocumentClosedEventArgs e) {
        try {
            // Notify clients that document was closed
            _ = this._schemaHub.Clients.All.SendAsync("DocumentChanged",
                new DocumentChangedNotification(null, true));

            Log.Debug("DocumentStateNotifier: Document closed");
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentClosed");
        }
    }

    private void OnDocumentChanged(object? sender, DocumentChangedEventArgs e) {
        try {
            // Check if any relevant elements were modified
            var doc = e.GetDocument();
            var allChangedIds = e.GetModifiedElementIds()
                .Concat(e.GetAddedElementIds())
                .Concat(e.GetDeletedElementIds());

            var hasRelevantChanges = allChangedIds.Any(id => {
                try {
                    var element = doc.GetElement(id);
                    if (element == null) return false;

                    // Check if it's a FamilySymbol (tag type)
                    if (element is FamilySymbol) return true;

                    // Check if it's a Family
                    if (element is Family) return true;

                    // Check category
                    var category = element.Category;
                    if (category == null) return false;

                    return RelevantCategories.Any(bc =>
                        category.BuiltInCategory == bc);
                } catch {
                    return false;
                }
            });

            if (hasRelevantChanges) {
                var docInfo = new DocumentInfo(doc.Title, doc.PathName, doc.IsModified);
                _ = this._schemaHub.Clients.All.SendAsync("DocumentChanged",
                    new DocumentChangedNotification(docInfo, true));

                Log.Debug("DocumentStateNotifier: Relevant changes detected, notifying clients");
            }
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentChanged");
        }
    }

    public void Dispose() {
        this._app.DocumentChanged -= this.OnDocumentChanged;
        this._app.DocumentOpened -= this.OnDocumentOpened;
        this._app.DocumentClosed -= this.OnDocumentClosed;
    }
}
