using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.Revit.Validation;

namespace Pe.StorageRuntime.Revit.Modules;

public sealed class SharedModuleSettingsStorage(
    ISettingsModule module,
    SettingsRuntimeCapabilities? availableCapabilities = null,
    IReadOnlyDictionary<string, SettingsStorageModuleDefinition>? moduleDefinitionsByModuleKey = null,
    string? basePath = null) {
    private readonly LocalDiskSettingsStorageBackend _backend = new(
        basePath ?? StorageClient.BasePath,
        availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly,
        CreateModuleDefinitionLookup(
            module,
            moduleDefinitionsByModuleKey,
            availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        )
    );

    private readonly string _basePath = basePath ?? StorageClient.BasePath;

    public string ModuleKey => module.ModuleKey;
    public string DefaultRootKey => module.DefaultSubDirectory;

    public Task<SettingsDiscoveryResult> DiscoverAsync(
        SettingsDiscoveryOptions? options = null,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) =>
        this._backend.DiscoverAsync(
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
    ) =>
        this._backend.OpenAsync(
            new OpenSettingsDocumentRequest(
                this.CreateDocumentId(relativePath, rootKey),
                includeComposedContent
            ),
            cancellationToken
        );

    public Task<SettingsDocumentSnapshot> ComposeAsync(
        string relativePath,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) =>
        this._backend.ComposeAsync(
            new OpenSettingsDocumentRequest(this.CreateDocumentId(relativePath, rootKey), true),
            cancellationToken
        );

    public Task<SaveSettingsDocumentResult> SaveAsync(
        string relativePath,
        string rawContent,
        SettingsVersionToken? expectedVersionToken = null,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) =>
        this._backend.SaveAsync(
            new SaveSettingsDocumentRequest(
                this.CreateDocumentId(relativePath, rootKey),
                rawContent,
                expectedVersionToken
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

    public string ResolveDocumentPath(string relativePath, string? rootKey = null) {
        var rootDirectory = this.ResolveRootDirectory(rootKey);
        return SettingsPathing.ResolveSafeRelativeJsonPath(rootDirectory, relativePath, nameof(relativePath));
    }

    private static IReadOnlyDictionary<string, SettingsStorageModuleDefinition> CreateModuleDefinitionLookup(
        ISettingsModule module,
        IReadOnlyDictionary<string, SettingsStorageModuleDefinition>? explicitDefinitions,
        SettingsRuntimeCapabilities availableCapabilities
    ) {
        if (explicitDefinitions != null) {
            if (!explicitDefinitions.ContainsKey(module.ModuleKey)) {
                throw new InvalidOperationException(
                    $"Shared storage definitions do not contain module '{module.ModuleKey}'."
                );
            }

            return explicitDefinitions;
        }

        return new Dictionary<string, SettingsStorageModuleDefinition>(StringComparer.OrdinalIgnoreCase) {
            [module.ModuleKey] = SettingsStorageModuleDefinition.CreateSingleRoot(
                module.DefaultSubDirectory,
                module.StorageOptions,
                module.SettingsType == typeof(object)
                    ? null
                    : new SchemaBackedSettingsDocumentValidator(
                        module.SettingsType,
                        availableCapabilities
                    )
            )
        };
    }
}
