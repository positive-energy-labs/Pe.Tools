using Pe.StorageRuntime;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.Host.Contracts;
using HostOpenRequest = Pe.Host.Contracts.OpenSettingsDocumentRequest;
using HostSaveRequest = Pe.Host.Contracts.SaveSettingsDocumentRequest;
using HostSaveResult = Pe.Host.Contracts.SaveSettingsDocumentResult;
using HostTreeRequest = Pe.Host.Contracts.SettingsTreeRequest;
using HostDiscoveryResult = Pe.Host.Contracts.SettingsDiscoveryResult;
using HostDocumentSnapshot = Pe.Host.Contracts.SettingsDocumentSnapshot;
using HostValidationRequest = Pe.Host.Contracts.ValidateSettingsDocumentRequest;
using HostValidationResult = Pe.Host.Contracts.SettingsValidationResult;
using HostWorkspacesData = Pe.Host.Contracts.SettingsWorkspacesData;

namespace Pe.Host.Services;

/// <summary>
///     Host-side entry point for the shared local-disk storage backend.
/// </summary>
public sealed class HostSettingsStorageService {
    private readonly SettingsRuntimeCapabilities _availableCapabilities;
    private readonly string _basePath;
    private readonly IHostSettingsModuleCatalog _moduleCatalog;

    public HostSettingsStorageService(IHostSettingsModuleCatalog moduleCatalog)
        : this(moduleCatalog, null, SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) { }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        IHostBridgeCapabilityService bridgeCapabilityService
    ) : this(moduleCatalog, bridgeCapabilityService, null, SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) { }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        string? basePath = null,
        SettingsRuntimeCapabilities? availableCapabilities = null
    ) : this(moduleCatalog, null, basePath, availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly) { }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        IHostBridgeCapabilityService? bridgeCapabilityService,
        string? basePath = null,
        SettingsRuntimeCapabilities? availableCapabilities = null
    ) {
        this._moduleCatalog = moduleCatalog;
        this._basePath = basePath ?? SettingsStorageLocations.GetDefaultBasePath();
        this._availableCapabilities = availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly;
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
    ) => (await this.CreateBackend().OpenAsync(request.ToRuntime(), cancellationToken)).ToContract();

    public async Task<HostDocumentSnapshot> ComposeAsync(
        HostOpenRequest request,
        CancellationToken cancellationToken = default
    ) => (await this.CreateBackend().ComposeAsync(request.ToRuntime(), cancellationToken)).ToContract();

    public async Task<HostSaveResult> SaveAsync(
        HostSaveRequest request,
        CancellationToken cancellationToken = default
    ) => (await this.CreateBackend().SaveAsync(request.ToRuntime(), cancellationToken)).ToContract();

    public async Task<HostValidationResult> ValidateAsync(
        HostValidationRequest request,
        CancellationToken cancellationToken = default
    ) => (await this.CreateBackend().ValidateAsync(request.ToRuntime(), cancellationToken)).ToContract();

    public HostWorkspacesData GetWorkspaces() => this._moduleCatalog.GetWorkspaces();

    private ISettingsStorageBackend CreateBackend() =>
        new LocalDiskSettingsStorageBackend(
            this._basePath,
            this._availableCapabilities,
            this._moduleCatalog.GetStorageDefinitions()
        );
}
