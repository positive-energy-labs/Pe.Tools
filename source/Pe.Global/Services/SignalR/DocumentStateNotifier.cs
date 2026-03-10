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
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);

    private readonly Application _app;
    private readonly IHubContext<SettingsEditorHub> _settingsEditorHub;
    private readonly object _sync = new();
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;
    private bool _disposed;
    private bool _isInitialized;
    private bool _isDocumentChangedSubscribed;
    private bool _isDocumentOpenedSubscribed;
    private bool _isDocumentClosedSubscribed;

    public DocumentStateNotifier(IHubContext<SettingsEditorHub> settingsEditorHub, Application app) {
        this._settingsEditorHub = settingsEditorHub;
        this._app = app;
    }

    /// <summary>
    ///     Initialize Revit document event subscriptions.
    ///     Must be called from a valid Revit API context.
    /// </summary>
    public void InitializeSubscriptions() {
        lock (this._sync) {
            if (this._disposed || this._isInitialized)
                return;

            this.TrySubscribeDocumentChanged();
            this.TrySubscribeDocumentOpened();
            this.TrySubscribeDocumentClosed();

            this._isInitialized = true;
        }
    }

    public void Dispose() {
        lock (this._sync) {
            if (this._disposed)
                return;

            if (this._isDocumentChangedSubscribed)
                this._app.DocumentChanged -= this.OnDocumentChanged;

            if (this._isDocumentOpenedSubscribed)
                this._app.DocumentOpened -= this.OnDocumentOpened;

            if (this._isDocumentClosedSubscribed)
                this._app.DocumentClosed -= this.OnDocumentClosed;

            this._disposed = true;
        }
    }

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        try {
            if (!HubConnectionTracker.HasActiveConnections)
                return;

            this.PublishDocumentInvalidation(
                new DocumentInvalidationEvent(
                    Reason: DocumentInvalidationReason.Opened,
                    DocumentTitle: e.Document.Title,
                    HasActiveDocument: true,
                    InvalidateFieldOptions: true,
                    InvalidateCatalogs: true,
                    InvalidateSchema: false
                )
            );
            Log.Debug("DocumentStateNotifier: Document opened - {Title}", e.Document.Title);
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentOpened");
        }
    }

    private void OnDocumentClosed(object? sender, DocumentClosedEventArgs e) {
        try {
            if (!HubConnectionTracker.HasActiveConnections)
                return;

            this.PublishDocumentInvalidation(
                new DocumentInvalidationEvent(
                    Reason: DocumentInvalidationReason.Closed,
                    DocumentTitle: null,
                    HasActiveDocument: false,
                    InvalidateFieldOptions: true,
                    InvalidateCatalogs: true,
                    InvalidateSchema: false
                )
            );
            Log.Debug("DocumentStateNotifier: Document closed");
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentClosed");
        }
    }

    private void OnDocumentChanged(object? sender, DocumentChangedEventArgs e) {
        try {
            if (!HubConnectionTracker.HasActiveConnections)
                return;

            // Revit can emit document-changed very frequently during some operations.
            // Debounce notifications to avoid notification/refetch storms.
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

            // TODO: Split this into module-scoped signals once module-specific
            // invalidation rules are defined. For now, treat any document change
            // as a generic "something changed" signal.
            this.PublishDocumentInvalidation(
                new DocumentInvalidationEvent(
                    Reason: DocumentInvalidationReason.Changed,
                    DocumentTitle: e.GetDocument().Title,
                    HasActiveDocument: true,
                    InvalidateFieldOptions: true,
                    InvalidateCatalogs: true,
                    InvalidateSchema: false
                )
            );
            Log.Debug(
                "DocumentStateNotifier: Document changed - generic notification sent (Modified={Modified}, Added={Added}, Deleted={Deleted})",
                modifiedCount,
                addedCount,
                deletedCount
            );
        } catch (Exception ex) {
            Log.Error(ex, "DocumentStateNotifier: Error handling DocumentChanged");
        }
    }

    private void PublishDocumentInvalidation(DocumentInvalidationEvent payload) =>
        _ = this._settingsEditorHub.Clients.All
            .SendAsync(HubClientEventNames.DocumentChanged, payload)
            .ContinueWith(task => {
                if (task.Exception != null)
                    Log.Warning(task.Exception, "DocumentStateNotifier: Failed to publish document invalidation.");
            }, TaskScheduler.Default);

    private void TrySubscribeDocumentChanged() {
        try {
            this._app.DocumentChanged += this.OnDocumentChanged;
            this._isDocumentChangedSubscribed = true;
        } catch (Exception ex) {
            Log.Warning(ex, "DocumentStateNotifier: Failed to subscribe DocumentChanged.");
        }
    }

    private void TrySubscribeDocumentOpened() {
        try {
            this._app.DocumentOpened += this.OnDocumentOpened;
            this._isDocumentOpenedSubscribed = true;
        } catch (Exception ex) {
            Log.Warning(ex, "DocumentStateNotifier: Failed to subscribe DocumentOpened.");
        }
    }

    private void TrySubscribeDocumentClosed() {
        try {
            this._app.DocumentClosed += this.OnDocumentClosed;
            this._isDocumentClosedSubscribed = true;
        } catch (Exception ex) {
            Log.Warning(ex, "DocumentStateNotifier: Failed to subscribe DocumentClosed.");
        }
    }
}