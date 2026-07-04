using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI.Events;
using Pe.Revit.Utils;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events only while the external bridge is connected.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly Func<BridgeStateSnapshot> _snapshot;
    private readonly Func<DocumentInvalidationEvent, Task> _publishAsync;
    private readonly object _sync = new();
    private bool _disposed;
    private bool _isInitialized;
    private string? _lastActiveDocumentKey;
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;
    private bool _lastHasActiveDocument;

    public BridgeDocumentNotifier(
        Func<BridgeStateSnapshot> snapshot,
        Func<DocumentInvalidationEvent, Task> publishAsync
    ) {
        this._snapshot = snapshot;
        this._publishAsync = publishAsync;
    }

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
                app.DocumentSaved -= OnDocumentSaved;
                app.DocumentSavedAs -= OnDocumentSavedAs;
                app.DocumentSynchronizedWithCentral -= OnDocumentSynchronized;
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
            app.DocumentSaved += OnDocumentSaved;
            app.DocumentSavedAs += OnDocumentSavedAs;
            app.DocumentSynchronizedWithCentral += OnDocumentSynchronized;
            this._isInitialized = true;
        }
    }

    public Task PublishInitialStateAsync() =>
        this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));

    private void OnDocumentOpened(object? sender, DocumentOpenedEventArgs e) {
        if (e?.Document != null)
            FamilySnapshotStore.WarmStart(e.Document);
        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Opened));
    }

    // Save boundaries are the only points where Element.VersionGuid is a valid identity, so
    // persistence lives exclusively in these handlers.
    private static void OnDocumentSaved(object? sender, DocumentSavedEventArgs e) {
        if (e?.Document != null)
            FamilySnapshotStore.Persist(e.Document);
    }

    private static void OnDocumentSavedAs(object? sender, DocumentSavedAsEventArgs e) {
        if (e?.Document != null)
            FamilySnapshotStore.Persist(e.Document);
    }

    private static void OnDocumentSynchronized(object? sender, DocumentSynchronizedWithCentralEventArgs e) {
        if (e?.Document != null)
            FamilySnapshotStore.Persist(e.Document);
    }

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

        // Rollback-sandbox churn (temp placements, snapshot probes) never persists; neither eviction
        // nor host notification applies (the rolled-back changes never became document state).
        if (DocumentSandbox.RollbackScopeActive || DocumentSandbox.IsSandboxTransaction(e.GetTransactionNames()))
            return;

        // Granular eviction runs synchronously per event with the element ids — never throttled,
        // never coalesced. Only the TS-bound invalidation event below is throttled.
        var changedDocument = e.GetDocument();
        if (changedDocument != null) {
            DocShadow.HandleChange(changedDocument, new DocumentDelta(
                e.GetAddedElementIds().Select(id => id.Value()).ToList(),
                e.GetModifiedElementIds().Select(id => id.Value()).ToList(),
                e.GetDeletedElementIds().Select(id => id.Value()).ToList(),
                e.GetTransactionNames().ToList()
            ));
        }

        lock (this._sync) {
            var utcNow = DateTime.UtcNow;
            if (utcNow - this._lastDocumentChangedNotificationUtc < DocumentChangedMinInterval)
                return;

            this._lastDocumentChangedNotificationUtc = utcNow;
        }

        _ = this.PublishAsync(this.BuildCurrentPayload(DocumentInvalidationReason.Changed));
    }

    private DocumentInvalidationEvent BuildCurrentPayload(DocumentInvalidationReason reason) {
        var snapshot = this._snapshot();
        return new DocumentInvalidationEvent(
            reason,
            snapshot.ActiveDocumentTitle,
            snapshot.ActiveDocumentKey,
            snapshot.ActiveDocumentPath,
            snapshot.ActiveDocumentIsFamilyDocument,
            snapshot.ActiveDocumentIsWorkshared,
            snapshot.ActiveDocumentIsModelInCloud,
            snapshot.ActiveDocumentCloudProjectGuid,
            snapshot.ActiveDocumentCloudModelGuid,
            snapshot.ActiveDocumentCloudModelUrn,
            snapshot.HasActiveDocument,
            snapshot.OpenDocumentCount,
            snapshot.ActiveDocumentObservedAtUnixMs,
            RevitVersion: snapshot.RevitVersion
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
            Log.Warning(ex, "Host bridge failed to publish document invalidation event.");
        }
    }
}
