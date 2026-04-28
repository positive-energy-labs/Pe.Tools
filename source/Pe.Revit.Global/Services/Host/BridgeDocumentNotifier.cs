using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI.Events;
using Pe.Shared.HostContracts.Protocol;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events only while the external bridge is connected.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly Func<DocumentInvalidationEvent, Task> _publishAsync;
    private readonly object _sync = new();
    private bool _disposed;
    private bool _isInitialized;
    private string? _lastActiveDocumentKey;
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;
    private bool _lastHasActiveDocument;

    public BridgeDocumentNotifier(Func<DocumentInvalidationEvent, Task> publishAsync) =>
        this._publishAsync = publishAsync;

    public void Dispose() {
        lock (this._sync) {
            if (this._disposed)
                return;

            if (this._isInitialized) {
                var uiApp = RevitUiSession.CurrentUIApplication;
                var app = uiApp.Application;
                uiApp.ViewActivated -= this.OnViewActivated;
                app.DocumentChanged -= this.OnDocumentChanged;
                app.DocumentOpened -= this.OnDocumentOpened;
                app.DocumentClosed -= this.OnDocumentClosed;
            }

            this._disposed = true;
        }
    }

    public void InitializeSubscriptions() {
        lock (this._sync) {
            if (this._disposed || this._isInitialized)
                return;
            var uiApp = RevitUiSession.CurrentUIApplication;
            var app = uiApp.Application;
            uiApp.ViewActivated += this.OnViewActivated;
            app.DocumentChanged += this.OnDocumentChanged;
            app.DocumentOpened += this.OnDocumentOpened;
            app.DocumentClosed += this.OnDocumentClosed;
            this._isInitialized = true;
        }
    }

    public Task PublishInitialStateAsync() =>
        this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) =>
        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Opened));

    private void OnDocumentClosed(object? sender, DocumentClosedEventArgs e) =>
        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Closed));

    private void OnViewActivated(object? sender, ViewActivatedEventArgs e) {
        var activeDocument = e?.CurrentActiveView?.Document;
        var currentKey = activeDocument == null ? null : activeDocument.GetDocumentKey();
        var hasActiveDocument = activeDocument != null;

        lock (this._sync) {
            if (string.Equals(this._lastActiveDocumentKey, currentKey, StringComparison.OrdinalIgnoreCase) &&
                this._lastHasActiveDocument == hasActiveDocument)
                return;
        }

        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));
    }

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
        var uiApp = RevitUiSession.CurrentUIApplication;
        var activeDocument = uiApp.GetActiveDocument();
        var activeDocumentKey = activeDocument == null ? null : activeDocument.GetDocumentKey();
        var activeDocumentPath = activeDocument == null ? null : activeDocument.GetDocumentPath();
        var activeDocumentCloudProjectGuid = activeDocument == null ? null : activeDocument.GetCloudProjectGuid();
        var activeDocumentCloudModelGuid = activeDocument == null ? null : activeDocument.GetCloudModelGuid();
        var activeDocumentCloudModelUrn = activeDocument == null ? null : activeDocument.GetCloudModelUrn();
        var openDocumentCount = uiApp.GetOpenDocuments().Count();
        return new DocumentInvalidationEvent(
            reason,
            activeDocument?.Title,
            activeDocumentKey,
            activeDocumentPath,
            activeDocument?.IsFamilyDocument ?? false,
            activeDocument?.IsWorkshared ?? false,
            activeDocument?.IsModelInCloud ?? false,
            activeDocumentCloudProjectGuid,
            activeDocumentCloudModelGuid,
            activeDocumentCloudModelUrn,
            activeDocument != null,
            openDocumentCount,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
    }

    private async Task PublishAsync(DocumentInvalidationEvent payload) {
        try {
            lock (this._sync) {
                this._lastActiveDocumentKey = payload.DocumentKey;
                this._lastHasActiveDocument = payload.HasActiveDocument;
            }

            await this._publishAsync(payload);
        } catch (Exception ex) {
            Log.Warning(ex, "SettingsEditor bridge failed to publish document invalidation event.");
        }
    }
}
