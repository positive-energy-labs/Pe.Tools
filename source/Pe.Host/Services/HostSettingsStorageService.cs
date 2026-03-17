using Pe.StorageRuntime;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Revit.Core.Json;
using HostOpenRequest = Pe.Host.Contracts.OpenSettingsDocumentRequest;
using HostSaveRequest = Pe.Host.Contracts.SaveSettingsDocumentRequest;
using HostSaveResult = Pe.Host.Contracts.SaveSettingsDocumentResult;
using HostTreeRequest = Pe.Host.Contracts.SettingsTreeRequest;
using HostDiscoveryResult = Pe.Host.Contracts.SettingsDiscoveryResult;
using HostDocumentSnapshot = Pe.Host.Contracts.SettingsDocumentSnapshot;
using HostValidationRequest = Pe.Host.Contracts.ValidateSettingsDocumentRequest;
using HostValidationResult = Pe.Host.Contracts.SettingsValidationResult;
using HostWorkspacesData = Pe.Host.Contracts.SettingsWorkspacesData;
using SettingsDocumentId = Pe.Host.Contracts.SettingsDocumentId;

namespace Pe.Host.Services;

/// <summary>
///     Host-side entry point for the shared local-disk storage backend.
/// </summary>
public sealed class HostSettingsStorageService {
    private readonly SettingsRuntimeCapabilities _availableCapabilities;
    private readonly string _basePath;
    private readonly IHostSettingsModuleCatalog _moduleCatalog;
    private readonly SettingsDocumentSchemaSyncService _schemaSyncService;

    public HostSettingsStorageService(IHostSettingsModuleCatalog moduleCatalog)
        : this(moduleCatalog, null, SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) {
    }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        string? basePath = null,
        SettingsRuntimeCapabilities? availableCapabilities = null
    ) {
        this._moduleCatalog = moduleCatalog;
        this._basePath = basePath ?? SettingsStorageLocations.GetDefaultBasePath();
        this._availableCapabilities = availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly;
        this._schemaSyncService = new SettingsDocumentSchemaSyncService(this._availableCapabilities);
    }

    public async Task<HostDiscoveryResult> DiscoverAsync(
        HostTreeRequest request,
        CancellationToken cancellationToken = default
    ) {
        var discovery = await this.CreateBackend().DiscoverAsync(
            request.ModuleKey,
            request.RootKey,
            new SettingsDiscoveryOptions(
                request.SubDirectory,
                request.Recursive,
                request.IncludeFragments,
                request.IncludeSchemas
            ),
            cancellationToken
        );
        return discovery.ToContract();
    }

    public async Task<HostDocumentSnapshot> OpenAsync(
        HostOpenRequest request,
        CancellationToken cancellationToken = default
    ) {
        this.TrySynchronizeDocumentOnDisk(request.DocumentId);
        return (await this.CreateBackend().OpenAsync(request.ToRuntime(), cancellationToken)).ToContract();
    }

    public async Task<HostDocumentSnapshot> ComposeAsync(
        HostOpenRequest request,
        CancellationToken cancellationToken = default
    ) {
        this.TrySynchronizeDocumentOnDisk(request.DocumentId);
        return (await this.CreateBackend().ComposeAsync(request.ToRuntime(), cancellationToken)).ToContract();
    }

    public async Task<HostSaveResult> SaveAsync(
        HostSaveRequest request,
        CancellationToken cancellationToken = default
    ) {
        var synchronizedRequest = this.SynchronizeRequestContent(request);
        return (await this.CreateBackend().SaveAsync(synchronizedRequest.ToRuntime(), cancellationToken)).ToContract();
    }

    public async Task<HostValidationResult> ValidateAsync(
        HostValidationRequest request,
        CancellationToken cancellationToken = default
    ) => (await this.CreateBackend().ValidateAsync(request.ToRuntime(), cancellationToken)).ToContract();

    public HostWorkspacesData GetWorkspaces() => this._moduleCatalog.GetWorkspaces();

    private void TrySynchronizeDocumentOnDisk(SettingsDocumentId documentId) {
        if (!this._moduleCatalog.TryGetModule(documentId.ModuleKey, out var module) ||
            module.SettingsType == typeof(object))
            return;

        var rootDirectory = SettingsStorageLocations.ResolveSettingsRootDirectory(
            this._basePath,
            documentId.ModuleKey,
            documentId.RootKey
        );
        var documentPath = SettingsPathing.ResolveSafeRelativeJsonPath(
            rootDirectory,
            documentId.RelativePath,
            nameof(documentId.RelativePath)
        );
        if (!File.Exists(documentPath))
            return;

        _ = this._schemaSyncService.EnsureSynchronized(
            module.SettingsType,
            module.StorageOptions,
            documentPath,
            rootDirectory
        );
    }

    private HostSaveRequest SynchronizeRequestContent(HostSaveRequest request) {
        if (!this._moduleCatalog.TryGetModule(request.DocumentId.ModuleKey, out var module) ||
            module.SettingsType == typeof(object))
            return request;

        var rootDirectory = SettingsStorageLocations.ResolveSettingsRootDirectory(
            this._basePath,
            request.DocumentId.ModuleKey,
            request.DocumentId.RootKey
        );
        var documentPath = SettingsPathing.ResolveSafeRelativeJsonPath(
            rootDirectory,
            request.DocumentId.RelativePath,
            nameof(request.DocumentId.RelativePath)
        );
        var synchronizedContent = this._schemaSyncService.SynchronizeContentForSave(
            module.SettingsType,
            module.StorageOptions,
            request.RawContent,
            documentPath,
            rootDirectory
        );

        return string.Equals(synchronizedContent, request.RawContent, StringComparison.Ordinal)
            ? request
            : request with { RawContent = synchronizedContent };
    }

    private LocalDiskSettingsStorageBackend CreateBackend() =>
        new(
            this._basePath,
            this._availableCapabilities,
            this._moduleCatalog.GetStorageDefinitions()
        );
}
