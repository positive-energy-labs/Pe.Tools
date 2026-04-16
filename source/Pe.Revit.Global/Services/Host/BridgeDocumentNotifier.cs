using Autodesk.Revit.DB.Events;
using Autodesk.Revit.UI.Events;
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
    private string? _lastActiveDocumentKey;
    private bool _lastHasActiveDocument;
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
                var uiApp = DocumentManager.uiapp;
                var app = DocumentManager.uiapp.Application;
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
            var uiApp = DocumentManager.uiapp;
            var app = DocumentManager.uiapp.Application;
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
        var currentKey = activeDocument == null ? null : DocumentManager.GetDocumentKey(activeDocument);
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
        var activeDocument = DocumentManager.uiapp.ActiveUIDocument?.Document;
        var activeDocumentKey = activeDocument == null ? null : DocumentManager.GetDocumentKey(activeDocument);
        var activeDocumentPath = activeDocument == null ? null : DocumentManager.GetDocumentPath(activeDocument);
        var activeDocumentCloudProjectGuid = activeDocument == null ? null : DocumentManager.GetCloudProjectGuid(activeDocument);
        var activeDocumentCloudModelGuid = activeDocument == null ? null : DocumentManager.GetCloudModelGuid(activeDocument);
        var activeDocumentCloudModelUrn = activeDocument == null ? null : DocumentManager.GetCloudModelUrn(activeDocument);
        var openDocumentCount = DocumentManager.GetOpenDocuments().Count();
        var invalidatedDomains = new List<HostInvalidationDomain> {
            HostInvalidationDomain.SettingsFieldOptions,
            HostInvalidationDomain.SettingsParameterCatalog,
            HostInvalidationDomain.ScheduleCatalog,
            HostInvalidationDomain.ScheduleSpecsQuery,
            HostInvalidationDomain.ScheduleQuery,
            HostInvalidationDomain.LoadedFamiliesCatalog,
            HostInvalidationDomain.LoadedFamiliesMatrix,
            HostInvalidationDomain.ProjectParameterBindings,
            HostInvalidationDomain.LoadedFamiliesFilterFieldOptions,
            HostInvalidationDomain.ElementContextQuery,
            HostInvalidationDomain.ElectricalPanelsCatalog,
            HostInvalidationDomain.ElectricalCircuitsCatalog,
            HostInvalidationDomain.ElectricalPanelSchedulesQuery,
            HostInvalidationDomain.ElectricalLoadClassificationsCatalog
        };
        this._invalidateDomains?.Invoke(invalidatedDomains);
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
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            invalidatedDomains
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
