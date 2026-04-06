using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Modules;

namespace Pe.StorageRuntime;

public sealed class ModuleDocumentStorage {
    private readonly LocalDiskSettingsStorageBackend _backend;
    private readonly string _basePath;

    public ModuleDocumentStorage(
        string moduleKey,
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        Type settingsType,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly,
        string? basePath = null,
        IReadOnlyDictionary<string, SettingsStorageModuleDefinition>? moduleDefinitionsByModuleKey = null
    ) {
        this.ModuleKey = string.IsNullOrWhiteSpace(moduleKey)
            ? throw new ArgumentException("Module key is required.", nameof(moduleKey))
            : moduleKey;
        this.DefaultRootKey = string.IsNullOrWhiteSpace(defaultRootKey)
            ? throw new ArgumentException("Default root key is required.", nameof(defaultRootKey))
            : defaultRootKey;
        this.StorageOptions = storageOptions ?? throw new ArgumentNullException(nameof(storageOptions));
        this.SettingsType = settingsType ?? throw new ArgumentNullException(nameof(settingsType));
        this.RuntimeMode = runtimeMode;
        this._basePath = string.IsNullOrWhiteSpace(basePath)
            ? StorageClient.BasePath
            : Path.GetFullPath(basePath);
        this._backend = new LocalDiskSettingsStorageBackend(
            this._basePath,
            runtimeMode,
            moduleDefinitionsByModuleKey ?? CreateDefaultModuleDefinitions(
                this.ModuleKey,
                this.DefaultRootKey,
                this.StorageOptions
            )
        );
    }

    public string ModuleKey { get; }
    public string DefaultRootKey { get; }
    public Type SettingsType { get; }
    public SettingsStorageModuleOptions StorageOptions { get; }
    public SettingsRuntimeMode RuntimeMode { get; }

    public Task<SettingsDiscoveryResult> DiscoverAsync(
        SettingsDiscoveryOptions? options = null,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) => this._backend.DiscoverAsync(
        this.ModuleKey,
        rootKey ?? this.DefaultRootKey,
        options ?? new SettingsDiscoveryOptions(),
        cancellationToken
    );

    public Task<SettingsDocumentSnapshot> OpenAsync(
        string relativePath,
        bool includeComposedContent = false,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) => this._backend.OpenAsync(
        new OpenSettingsDocumentRequest(
            this.CreateDocumentId(relativePath, rootKey),
            includeComposedContent
        ),
        cancellationToken
    );

    public Task<SaveSettingsDocumentResult> SaveAsync(
        string relativePath,
        string rawContent,
        SettingsVersionToken? expectedVersionToken = null,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) => this._backend.SaveAsync(
        new SaveSettingsDocumentRequest(
            this.CreateDocumentId(relativePath, rootKey),
            rawContent,
            expectedVersionToken
        ),
        cancellationToken
    );

    public Task<SettingsValidationResult> ValidateAsync(
        string relativePath,
        string rawContent,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) => this._backend.ValidateAsync(
        new ValidateSettingsDocumentRequest(
            this.CreateDocumentId(relativePath, rootKey),
            rawContent
        ),
        cancellationToken
    );

    public SettingsDocumentId CreateDocumentId(string relativePath, string? rootKey = null) =>
        new(this.ModuleKey, rootKey ?? this.DefaultRootKey, relativePath);

    public string ResolveRootDirectory(string? rootKey = null) =>
        SettingsStorageLocations.ResolveSettingsRootDirectory(
            this._basePath,
            this.ModuleKey,
            rootKey ?? this.DefaultRootKey
        );

    public string ResolveDocumentPath(string relativePath, string? rootKey = null) =>
        SettingsPathing.ResolveSafeRelativeJsonPath(
            this.ResolveRootDirectory(rootKey),
            relativePath,
            nameof(relativePath)
        );

    private static IReadOnlyDictionary<string, SettingsStorageModuleDefinition> CreateDefaultModuleDefinitions(
        string moduleKey,
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions
    ) => new Dictionary<string, SettingsStorageModuleDefinition>(StringComparer.OrdinalIgnoreCase) {
        [moduleKey] = SettingsStorageModuleDefinition.CreateSingleRoot(defaultRootKey, storageOptions)
    };
}
