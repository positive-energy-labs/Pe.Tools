using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI;
using Pe.Global.Services.Document;
using Pe.Host.Contracts;
using Serilog;

namespace Pe.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events only while the external bridge is connected.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly Func<DocumentInvalidationEvent, Task> _publishAsync;
    private readonly object _sync = new();
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;
    private bool _disposed;
    private bool _isInitialized;

    public BridgeDocumentNotifier(
        Func<DocumentInvalidationEvent, Task> publishAsync
    ) {
        this._publishAsync = publishAsync;
    }

    public void InitializeSubscriptions() {
        lock (this._sync) {
            if (this._disposed || this._isInitialized)
                return;
            var app = DocumentManager.uiapp.Application;
            app.DocumentChanged += this.OnDocumentChanged;
            app.DocumentOpened += this.OnDocumentOpened;
            app.DocumentClosed += this.OnDocumentClosed;
            this._isInitialized = true;
        }
    }

    public Task PublishInitialStateAsync() =>
        this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));

    public void Dispose() {
        lock (this._sync) {
            if (this._disposed)
                return;

            if (this._isInitialized) {
                var app = DocumentManager.uiapp.Application;
                app.DocumentChanged -= this.OnDocumentChanged;
                app.DocumentOpened -= this.OnDocumentOpened;
                app.DocumentClosed -= this.OnDocumentClosed;
            }

            this._disposed = true;
        }
    }

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) =>
        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Opened));

    private void OnDocumentClosed(object? sender, DocumentClosedEventArgs e) =>
        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Closed));

    private void OnDocumentChanged(object? sender, DocumentChangedEventArgs e) {
        var modifiedCount = e.GetModifiedElementIds().Count;
        var addedCount = e.GetAddedElementIds().Count;
        var deletedCount = e.GetDeletedElementIds().Count;
        if (modifiedCount == 0 && addedCount == 0 && deletedCount == 0)
            return;

        lock (this._sync) {
            var utcNow = DateTime.UtcNow;
            if (utcNow - this._lastDocumentChangedNotificationUtc < DocumentChangedMinInterval)
                return;

            this._lastDocumentChangedNotificationUtc = utcNow;
        }

        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));
    }

    private DocumentInvalidationEvent BuildCurrentPayload(DocumentInvalidationReason reason) {
        return new DocumentInvalidationEvent(
            Reason: reason,
            DocumentTitle: DocumentManager.GetActiveDocument()?.Title,
            HasActiveDocument: DocumentManager.GetActiveDocument() != null,
            InvalidateFieldOptions: true,
            InvalidateCatalogs: true,
            InvalidateSchema: false
        );
    }

    private async Task PublishAsync(DocumentInvalidationEvent payload) {
        try {
            await this._publishAsync(payload);
        } catch (Exception ex) {
            Log.Warning(ex, "SettingsEditor bridge failed to publish document invalidation event.");
        }
    }
}
