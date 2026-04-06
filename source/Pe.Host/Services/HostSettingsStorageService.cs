using Pe.Shared.StorageRuntime;
using Pe.Shared.SettingsCatalog;
using Pe.Shared.SettingsCatalog.Manifests;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;
using Pe.Shared.StorageRuntime.Core.Json;
using HostOpenRequest = Pe.Shared.HostContracts.SettingsStorage.OpenSettingsDocumentRequest;
using HostSaveRequest = Pe.Shared.HostContracts.SettingsStorage.SaveSettingsDocumentRequest;
using HostSaveResult = Pe.Shared.HostContracts.SettingsStorage.SaveSettingsDocumentResult;
using HostTreeRequest = Pe.Shared.HostContracts.SettingsStorage.SettingsTreeRequest;
using HostDiscoveryResult = Pe.Shared.HostContracts.SettingsStorage.SettingsDiscoveryResult;
using HostDocumentSnapshot = Pe.Shared.HostContracts.SettingsStorage.SettingsDocumentSnapshot;
using HostValidationRequest = Pe.Shared.HostContracts.SettingsStorage.ValidateSettingsDocumentRequest;
using HostValidationResult = Pe.Shared.HostContracts.SettingsStorage.SettingsValidationResult;
using HostWorkspacesData = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspacesData;
using SettingsDocumentId = Pe.Shared.HostContracts.SettingsStorage.SettingsDocumentId;
using RuntimeSettingsVersionToken = Pe.Shared.StorageRuntime.Documents.SettingsVersionToken;

namespace Pe.Host.Services;

/// <summary>
///     Host-side entry point for the shared local-disk storage backend.
/// </summary>
public sealed class HostSettingsStorageService {
    private readonly string _basePath;
    private readonly IHostSettingsModuleCatalog _moduleCatalog;
    private readonly SettingsRuntimeMode _runtimeMode;
    private readonly SettingsDocumentSchemaSyncService _schemaSyncService;

    public HostSettingsStorageService(IHostSettingsModuleCatalog moduleCatalog)
        : this(moduleCatalog, null, SettingsRuntimeMode.HostOnly) {
    }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        string? basePath = null,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly
    ) {
        this._moduleCatalog = moduleCatalog;
        this._basePath = basePath ?? SettingsStorageLocations.GetDefaultBasePath();
        this._runtimeMode = runtimeMode;
        this._schemaSyncService = new SettingsDocumentSchemaSyncService(runtimeMode);
    }

    public async Task<HostDiscoveryResult> DiscoverAsync(
        HostTreeRequest request,
        CancellationToken cancellationToken = default
    ) {
        var module = this.ResolveModule(request.ModuleKey);
        var discovery = await this.CreateDocuments(module).DiscoverAsync(
            new SettingsDiscoveryOptions(
                request.SubDirectory,
                request.Recursive,
                request.IncludeFragments,
                request.IncludeSchemas
            ),
            request.RootKey,
            cancellationToken
        );
        return discovery.ToContract();
    }

    public async Task<HostDocumentSnapshot> OpenAsync(
        HostOpenRequest request,
        CancellationToken cancellationToken = default
    ) {
        this.TrySynchronizeDocumentOnDisk(request.DocumentId);
        var documents = this.CreateDocuments(this.ResolveModule(request.DocumentId.ModuleKey));
        return (await documents.OpenAsync(
            request.DocumentId.RelativePath,
            request.IncludeComposedContent,
            request.DocumentId.RootKey,
            cancellationToken
        )).ToContract();
    }

    public async Task<HostSaveResult> SaveAsync(
        HostSaveRequest request,
        CancellationToken cancellationToken = default
    ) {
        var synchronizedRequest = this.SynchronizeRequestContent(request);
        var documents = this.CreateDocuments(this.ResolveModule(synchronizedRequest.DocumentId.ModuleKey));
        return (await documents.SaveAsync(
            synchronizedRequest.DocumentId.RelativePath,
            synchronizedRequest.RawContent,
            synchronizedRequest.ExpectedVersionToken is null
                ? null
                : new RuntimeSettingsVersionToken(synchronizedRequest.ExpectedVersionToken.Value),
            synchronizedRequest.DocumentId.RootKey,
            cancellationToken
        )).ToContract();
    }

    public async Task<HostValidationResult> ValidateAsync(
        HostValidationRequest request,
        CancellationToken cancellationToken = default
    ) {
        var documents = this.CreateDocuments(this.ResolveModule(request.DocumentId.ModuleKey));
        return (await documents.ValidateAsync(
            request.DocumentId.RelativePath,
            request.RawContent,
            request.DocumentId.RootKey,
            cancellationToken
        )).ToContract();
    }

    public HostWorkspacesData GetWorkspaces() => this._moduleCatalog.GetWorkspaces();

    private ISettingsModuleManifest ResolveModule(string moduleKey) =>
        this._moduleCatalog.TryGetModule(moduleKey, out var module)
            ? module
            : throw new InvalidOperationException($"Unknown settings module '{moduleKey}'.");

    private ModuleDocumentStorage CreateDocuments(ISettingsModuleManifest module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.StorageOptions,
            module.SettingsType,
            this._runtimeMode,
            this._basePath,
            new Dictionary<string, SettingsStorageModuleDefinition>(StringComparer.OrdinalIgnoreCase) {
                [module.ModuleKey] = module.CreateStorageDefinition(this._runtimeMode)
            }
        );

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
}
