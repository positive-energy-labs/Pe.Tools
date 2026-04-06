using Autodesk.Revit.DB.Events;
using Pe.Shared.HostContracts.Protocol;
using Pe.Revit.Global.Services.Document;
using Serilog;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Publishes document invalidation events only while the external bridge is connected.
/// </summary>
internal sealed class BridgeDocumentNotifier : IDisposable {
    private static readonly TimeSpan DocumentChangedMinInterval = TimeSpan.FromMilliseconds(750);
    private readonly Action<IReadOnlyList<HostInvalidationDomain>>? _invalidateDomains;
    private readonly Func<DocumentInvalidationEvent, Task> _publishAsync;
    private readonly object _sync = new();
    private bool _disposed;
    private bool _isInitialized;
    private DateTime _lastDocumentChangedNotificationUtc = DateTime.MinValue;

    public BridgeDocumentNotifier(
        Func<DocumentInvalidationEvent, Task> publishAsync,
        Action<IReadOnlyList<HostInvalidationDomain>>? invalidateDomains = null
    ) {
        this._publishAsync = publishAsync;
        this._invalidateDomains = invalidateDomains;
    }

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
        var activeDocument = DocumentManager.uiapp.ActiveUIDocument?.Document;
        var invalidatedDomains = new List<HostInvalidationDomain> {
            HostInvalidationDomain.SettingsFieldOptions,
            HostInvalidationDomain.SettingsParameterCatalog,
            HostInvalidationDomain.ScheduleCatalog,
            HostInvalidationDomain.LoadedFamiliesCatalog,
            HostInvalidationDomain.LoadedFamiliesMatrix,
            HostInvalidationDomain.ProjectParameterBindings,
            HostInvalidationDomain.LoadedFamiliesFilterFieldOptions
        };
        this._invalidateDomains?.Invoke(invalidatedDomains);
        return new DocumentInvalidationEvent(
            reason,
            activeDocument?.Title,
            activeDocument != null,
            invalidatedDomains
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