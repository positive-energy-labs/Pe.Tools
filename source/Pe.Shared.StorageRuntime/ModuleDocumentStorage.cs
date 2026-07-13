using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Documents;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.StorageRuntime;

public sealed class ModuleDocumentStorage {
    private readonly string _basePath;

    public ModuleDocumentStorage(
        string moduleKey,
        string defaultRootKey,
        SettingsStorageModuleOptions storageOptions,
        SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly,
        string? basePath = null
    ) {
        this.ModuleKey = string.IsNullOrWhiteSpace(moduleKey)
            ? throw new ArgumentException("Module key is required.", nameof(moduleKey))
            : moduleKey;
        this.DefaultRootKey = string.IsNullOrWhiteSpace(defaultRootKey)
            ? throw new ArgumentException("Default root key is required.", nameof(defaultRootKey))
            : defaultRootKey;
        this.StorageOptions = storageOptions ?? throw new ArgumentNullException(nameof(storageOptions));
        this.RuntimeMode = runtimeMode;
        this._basePath = string.IsNullOrWhiteSpace(basePath)
            ? StorageClient.BasePath
            : Path.GetFullPath(basePath);
    }

    public string ModuleKey { get; }
    public string DefaultRootKey { get; }
    public SettingsStorageModuleOptions StorageOptions { get; }
    public SettingsRuntimeMode RuntimeMode { get; }

    public Task<SettingsDiscoveryResult> DiscoverAsync(
        SettingsDiscoveryOptions? options = null,
        string? rootKey = null,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();

        options ??= new SettingsDiscoveryOptions();
        var resolvedRootKey = rootKey ?? this.DefaultRootKey;
        var rootDirectory = this.ResolveRootDirectory(resolvedRootKey);
        var discoveryRootPath = SettingsPathing.ResolveSafeSubDirectoryPath(
            rootDirectory,
            options.SubDirectory,
            nameof(options.SubDirectory)
        );
        var normalizedRootRelativePath = SettingsPathing.NormalizeRelativePath(
            options.SubDirectory,
            nameof(options.SubDirectory)
        );
        var rootName = string.IsNullOrWhiteSpace(normalizedRootRelativePath)
            ? resolvedRootKey
            : normalizedRootRelativePath.Split('/').Last();

        if (!Directory.Exists(discoveryRootPath))
            _ = Directory.CreateDirectory(discoveryRootPath);

        var searchOption = options.Recursive
            ? SearchOption.AllDirectories
            : SearchOption.TopDirectoryOnly;
        var directories = Directory.EnumerateDirectories(discoveryRootPath, "*", searchOption)
            .Select(path => BclCompat.GetRelativePath(rootDirectory, path).Replace('\\', '/'))
            .ToList();
        var files = Directory.EnumerateFiles(discoveryRootPath, "*.json", searchOption)
            .Select(path => SettingsDiscoveryBuilder.CreateSettingsFileEntry(path, rootDirectory))
            .Where(entry => options.IncludeFragments || !entry.IsFragment)
            .Where(entry => options.IncludeSchemas || !entry.IsSchema)
            .OrderByDescending(entry => entry.ModifiedUtc)
            .ToList();

        var tree = SettingsDiscoveryBuilder.BuildDirectoryTree(
            rootName,
            normalizedRootRelativePath,
            files,
            directories
        );

        return Task.FromResult(new SettingsDiscoveryResult(files, tree));
    }

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

}
