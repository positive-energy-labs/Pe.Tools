using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Shared.StorageRuntime.Context;
using Pe.Shared.StorageRuntime.Core.Json;
using Pe.Shared.StorageRuntime.Core.Json.ContractResolvers;

namespace Pe.Shared.StorageRuntime.Modules;

public static class TypedModuleStorageExtensions {
    public static ModuleSettingsStorage<TSettings> Settings<TSettings>(
        this ModuleStorage<TSettings> storage,
        ISettingsDocumentContextAccessor? documentContextAccessor = null
    ) where TSettings : class, new() =>
        new(storage.Documents(), documentContextAccessor);
}

public sealed class ModuleSettingsStorage<TSettings>(
    ModuleDocumentStorage documents,
    ISettingsDocumentContextAccessor? documentContextAccessor = null
) where TSettings : class, new() {
    private static readonly JsonSerializerSettings DeserializerSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RevitTypeContractResolver(),
        NullValueHandling = NullValueHandling.Ignore
    };

    private readonly ModuleDocumentStorage _documents = documents ?? throw new ArgumentNullException(nameof(documents));
    private readonly ISettingsDocumentContextAccessor? _documentContextAccessor = documentContextAccessor;

    public TSettings ReadRequired(string relativePath, string? rootKey = null) {
        var resolvedRootKey = rootKey ?? _documents.DefaultRootKey;
        this.EnsureSynchronized(relativePath, resolvedRootKey);

        var snapshot = _documents.OpenAsync(relativePath, true, resolvedRootKey).GetAwaiter().GetResult();
        if (!snapshot.Validation.IsValid) {
            throw new JsonValidationException(
                _documents.ResolveDocumentPath(relativePath, resolvedRootKey),
                snapshot.Validation.Issues.Select(issue => $"{issue.Path}: {issue.Message}")
            );
        }

        var content = snapshot.ComposedContent ?? snapshot.RawContent;
        return JsonConvert.DeserializeObject<TSettings>(content, DeserializerSettings) ?? new TSettings();
    }

    public TSettings ReadOrDefault(string relativePath, string? rootKey = null) {
        try {
            return this.ReadRequired(relativePath, rootKey);
        } catch (FileNotFoundException) {
            return new TSettings();
        }
    }

    public string ResolveDocumentPath(string relativePath, string? rootKey = null) =>
        _documents.ResolveDocumentPath(relativePath, rootKey);

    public ModuleDocumentStorage Documents() => _documents;

    private void EnsureSynchronized(string relativePath, string rootKey) {
        var syncService = new SettingsDocumentSchemaSyncService(_documents.RuntimeMode, _documentContextAccessor);
        var documentPath = _documents.ResolveDocumentPath(relativePath, rootKey);
        var rootDirectory = _documents.ResolveRootDirectory(rootKey);

        syncService.EnsureSynchronized(
            _documents.SettingsType,
            _documents.StorageOptions,
            documentPath,
            rootDirectory
        );
    }
}
