using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;
using HostOpenRequest = Pe.Shared.HostContracts.SettingsStorage.OpenSettingsDocumentRequest;
using HostSaveRequest = Pe.Shared.HostContracts.SettingsStorage.SaveSettingsDocumentRequest;
using HostSaveResult = Pe.Shared.HostContracts.SettingsStorage.SaveSettingsDocumentResult;
using HostTreeRequest = Pe.Shared.HostContracts.SettingsStorage.SettingsTreeRequest;
using HostDiscoveryResult = Pe.Shared.HostContracts.SettingsStorage.SettingsDiscoveryResult;
using HostDocumentSnapshot = Pe.Shared.HostContracts.SettingsStorage.SettingsDocumentSnapshot;
using HostValidationRequest = Pe.Shared.HostContracts.SettingsStorage.ValidateSettingsDocumentRequest;
using HostValidationResult = Pe.Shared.HostContracts.SettingsStorage.SettingsValidationResult;
using HostWorkspacesData = Pe.Shared.HostContracts.SettingsStorage.SettingsWorkspacesData;
using HostWorkspacesRequest = Pe.Shared.HostContracts.SettingsStorage.GetSettingsWorkspacesRequest;
using RuntimeSettingsVersionToken = Pe.Shared.StorageRuntime.Documents.SettingsVersionToken;

namespace Pe.Host.Services;

/// <summary>
///     Host-side entry point for the shared local-disk storage backend.
/// </summary>
public sealed class HostSettingsStorageService {
    private readonly string _basePath;
    private readonly BridgeServer _bridgeServer;
    private readonly IHostSettingsModuleCatalog _moduleCatalog;
    private readonly SettingsRuntimeMode _runtimeMode;

    public HostSettingsStorageService(IHostSettingsModuleCatalog moduleCatalog, BridgeServer bridgeServer)
        : this(moduleCatalog, bridgeServer, null) {
    }

    public HostSettingsStorageService(
        IHostSettingsModuleCatalog moduleCatalog,
        BridgeServer bridgeServer,
        string? basePath = null,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly
    ) {
        this._moduleCatalog = moduleCatalog;
        this._bridgeServer = bridgeServer;
        this._basePath = basePath ?? SettingsStorageLocations.GetDefaultBasePath();
        this._runtimeMode = runtimeMode;
    }

    public async Task<HostDiscoveryResult> DiscoverAsync(
        HostTreeRequest request,
        CancellationToken cancellationToken = default
    ) {
        var module = await this.ResolveModuleAsync(request.ModuleKey, cancellationToken);
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
        var documents = this.CreateDocuments(
            await this.ResolveModuleAsync(request.DocumentId.ModuleKey, cancellationToken)
        );
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
        var documents = this.CreateDocuments(
            await this.ResolveModuleAsync(request.DocumentId.ModuleKey, cancellationToken)
        );
        return (await documents.SaveAsync(
            request.DocumentId.RelativePath,
            request.RawContent,
            request.ExpectedVersionToken is null
                ? null
                : new RuntimeSettingsVersionToken(request.ExpectedVersionToken.Value),
            request.DocumentId.RootKey,
            cancellationToken
        )).ToContract();
    }

    public async Task<HostValidationResult> ValidateAsync(
        HostValidationRequest request,
        CancellationToken cancellationToken = default
    ) {
        var documents = this.CreateDocuments(
            await this.ResolveModuleAsync(request.DocumentId.ModuleKey, cancellationToken)
        );
        return (await documents.ValidateAsync(
            request.DocumentId.RelativePath,
            request.RawContent,
            request.DocumentId.RootKey,
            cancellationToken
        )).ToContract();
    }

    public Task<HostWorkspacesData> GetWorkspacesAsync(
        HostWorkspacesRequest request,
        CancellationToken cancellationToken = default
    ) => this._moduleCatalog.GetWorkspacesAsync(cancellationToken);

    private async Task<StructuralSettingsModuleDescriptor> ResolveModuleAsync(
        string moduleKey,
        CancellationToken cancellationToken
    ) {
        var module = await this._moduleCatalog.TryGetModuleAsync(moduleKey, cancellationToken);
        return module ?? throw new InvalidOperationException($"Unknown settings module '{moduleKey}'.");
    }

    private ModuleDocumentStorage CreateDocuments(StructuralSettingsModuleDescriptor module) =>
        new(
            module.ModuleKey,
            module.DefaultRootKey,
            module.StorageOptions,
            this._runtimeMode,
            this._basePath,
            new Dictionary<string, SettingsStorageModuleRuntimeDefinition>(StringComparer.OrdinalIgnoreCase) {
                [module.ModuleKey] = new(
                    module.DefaultRootKey,
                    module.Roots.Select(root => root.RootKey).ToList(),
                    module.StorageOptions,
                    this.CreateRootValidators(module)
                )
            }
        );

    private IReadOnlyDictionary<string, ISettingsDocumentValidator?> CreateRootValidators(
        StructuralSettingsModuleDescriptor module
    ) => module.Roots.ToDictionary(
        root => root.RootKey,
        root => this.CreateValidator(module, root.RootKey),
        StringComparer.OrdinalIgnoreCase
    );

    private ISettingsDocumentValidator? CreateValidator(
        StructuralSettingsModuleDescriptor module,
        string rootKey
    ) =>
        module.HostScope == SettingsModuleHostScope.Host
            ? null
            : new BridgeSchemaSettingsDocumentValidator(this._bridgeServer, module.ModuleKey, rootKey);
}
