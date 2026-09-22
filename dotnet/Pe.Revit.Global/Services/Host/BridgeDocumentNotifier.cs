using Autodesk.Revit.UI.Events;
using Pe.Revit.Extensions.ProjDocument;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Loader.Documents;
using Pe.Shared.HostContracts.Bridge;
using Pe.Shared.HostContracts.Protocol;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events to the TS host while the external bridge is
///     connected. Pure tracker subscriber: identity, dedupe (ActiveChanged), and sandbox/empty
///     filtering (ChangeFilter) are the tracker's job; cache upkeep is DocumentCacheMaintenance's.
///     Only the notification throttle lives here, and it publishes its trailing edge: a change
///     inside the 750 ms window arms one pending publish on the next Revit idle past the window,
///     carrying every document that changed in it. Nothing is dropped.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly IDocumentTracker _documents;
    private readonly Func<BridgeStateSnapshot> _snapshot;
    private readonly Func<DocumentInvalidationEvent, BridgeStateSnapshot, Task> _publishAsync;
    private readonly object _sync = new();
    /// <summary>Documents changed since the last publish; drained into the next one.</summary>
    private readonly HashSet<string> _changedOpenIds = new(StringComparer.Ordinal);
    private bool _disposed;
    private bool _isInitialized;
    private bool _isReplaying;
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;
    /// <summary>The single armed trailing publish; null when none is pending.</summary>
    private EventHandler<IdlingEventArgs>? _trailing;

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

            if (this._trailing is not null) {
                RevitUiSession.CurrentUIApplication.Idling -= this._trailing;
                this._trailing = null;
            }

            if (this._isInitialized) {
                this._documents.Opened -= this.OnOpened;
                this._documents.Closed -= this.OnClosed;
                this._documents.ActiveChanged -= this.OnActiveChanged;
                this._documents.KeyChanged -= this.OnKeyChanged;
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
            this._documents.KeyChanged += this.OnKeyChanged;
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
        // Revit titles an EditFamily document after DocumentOpened (w8-revit 2c), and nothing else
        // fires for it. Every open republishes once, on the next idle; the snapshot reads titles live.
        var uiApplication = RevitUiSession.CurrentUIApplication;
        EventHandler<IdlingEventArgs>? republish = null;
        republish = (_, _) => {
            uiApplication.Idling -= republish;
            if (!this._disposed)
                _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);
        };
        uiApplication.Idling += republish;
    }

    private void OnClosed(DocumentKey key) =>
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Closed);

    private void OnActiveChanged(TrackedDocument? active) =>
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);

    // SaveAs and first save move the address; the host must hear it without waiting for an edit.
    private void OnKeyChanged(TrackedDocument tracked, DocumentKey previous) =>
        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);

    private void OnChanged(TrackedDocument tracked, Autodesk.Revit.DB.Events.DocumentChangedEventArgs e) {
        lock (this._sync) {
            if (this._disposed)
                return;

            this._changedOpenIds.Add(tracked.OpenId());
            var utcNow = DateTime.UtcNow;
            if (utcNow - this._lastDocumentChangedNotificationUtc < DocumentChangedMinInterval) {
                this.ArmTrailingPublish();
                return;
            }

            this._lastDocumentChangedNotificationUtc = utcNow;
        }

        _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);
    }

    /// <summary>
    ///     Arms at most one trailing publish. Idling is the only Revit API thread we can hand a
    ///     delayed publish to (the snapshot reads the API); it fires past the window and unarms.
    /// </summary>
    private void ArmTrailingPublish() {
        if (this._trailing is not null)
            return;

        var uiApplication = RevitUiSession.CurrentUIApplication;
        this._trailing = (_, _) => {
            lock (this._sync) {
                if (this._trailing is null)
                    return;
                if (!this._disposed
                    && DateTime.UtcNow - this._lastDocumentChangedNotificationUtc < DocumentChangedMinInterval)
                    return;

                uiApplication.Idling -= this._trailing;
                this._trailing = null;
                if (this._disposed)
                    return;

                this._lastDocumentChangedNotificationUtc = DateTime.UtcNow;
            }

            _ = this.PublishCurrentAsync(DocumentInvalidationReason.Changed);
        };
        uiApplication.Idling += this._trailing;
    }

    private Task PublishCurrentAsync(DocumentInvalidationReason reason) {
        var snapshot = this._snapshot();
        List<string> changed;
        lock (this._sync) {
            changed = [.. this._changedOpenIds];
            this._changedOpenIds.Clear();
        }

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
            changed,
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
