using Pe.Revit.Loader.Documents;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events to the TS host while the external bridge is
///     connected. Pure tracker subscriber: identity, dedupe (ActiveChanged), and sandbox/empty
///     filtering (ChangeFilter) are the tracker's job; cache upkeep is DocumentCacheMaintenance's.
///     Only the notification throttle lives here.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly IDocumentTracker _documents;
    private readonly Func<BridgeStateSnapshot> _snapshot;
    private readonly Func<DocumentInvalidationEvent, BridgeStateSnapshot, Task> _publishAsync;
    private readonly object _sync = new();
    private bool _disposed;
    private bool _isInitialized;
    private bool _isReplaying;
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;

    public BridgeDocumentNotifier(
        IDocumentTracker documents,
        Func<BridgeStateSnapshot> snapshot,
        Func<DocumentInvalidationEvent, BridgeStateSnapshot, Task> publishAsync
    ) {
        this._documents = documents;
        this._snapshot = snapshot;
        this._publishAsync = publishAsync;
    }

    public void Dispose() {
        lock (this._sync) {
            if (this._disposed)
                return;

            if (this._isInitialized) {
                this._documents.Opened -= this.OnOpened;
                this._documents.Closed -= this.OnClosed;
                this._documents.ActiveChanged -= this.OnActiveChanged;
                this._documents.Changed -= this.OnChanged;
            }

            this._disposed = true;
        }
    }

    public void InitializeSubscriptions() {
        lock (this._sync) {
            if (this._disposed || this._isInitialized)
                return;

            // Opened replays every open document synchronously inside the subscribe; the initial
            // state publish covers that, so replay notifications are suppressed.
            this._isReplaying = true;
            this._documents.Opened += this.OnOpened;
            this._isReplaying = false;
            this._documents.Closed += this.OnClosed;
            this._documents.ActiveChanged += this.OnActiveChanged;
            this._documents.Changed += this.OnChanged;
            this._isInitialized = true;
        }
    }

    public Task PublishInitialStateAsync() =>
        this.PublishCurrentAsync(DocumentInvalidationReason.Changed);

    private void OnOpened(TrackedDocument tracked) {
        if (this._isReplaying)
            return;
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Opened);
    }

    private void OnClosed(DocumentKey key) =>
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Closed);

    private void OnActiveChanged(TrackedDocument? active) =>
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);

    private void OnChanged(TrackedDocument tracked, Autodesk.Revit.DB.Events.DocumentChangedEventArgs e) {
        lock (this._sync) {
            var utcNow = DateTime.UtcNow;
            if (utcNow - this._lastDocumentChangedNotificationUtc < DocumentChangedMinInterval)
                return;

            this._lastDocumentChangedNotificationUtc = utcNow;
        }

        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);
    }

    private Task PublishCurrentAsync(DocumentInvalidationReason reason) {
        var snapshot = this._snapshot();
        var payload = new DocumentInvalidationEvent(
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
            snapshot.OpenDocuments.Count,
            snapshot.ActiveDocumentObservedAtUnixMs,
            RevitVersion: snapshot.RevitVersion
        );
        return this.PublishAsync(payload, snapshot);
    }

    private async Task PublishAsync(DocumentInvalidationEvent payload, BridgeStateSnapshot snapshot) {
        try {
            await this._publishAsync(payload, snapshot);
        } catch (Exception ex) {
            Log.Warning(ex, "Host bridge failed to publish document invalidation event.");
        }
    }
}
