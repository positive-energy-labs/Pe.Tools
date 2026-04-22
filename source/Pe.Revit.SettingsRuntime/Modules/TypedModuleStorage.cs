using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Revit.SettingsRuntime.Json;
using Pe.Revit.SettingsRuntime.Json.ContractResolvers;

namespace Pe.Revit.SettingsRuntime.Modules;

public static class TypedModuleStorageExtensions {
    public static ModuleSettingsStorage<TSettings> Settings<TSettings>(
        this ModuleStorage<TSettings> storage
    ) where TSettings : class =>
        new(storage.Documents());
}

public sealed class ModuleSettingsStorage<TSettings>(
    ModuleDocumentStorage documents
) where TSettings : class {
    private static readonly JsonSerializerSettings DeserializerSettings = new() {
        Formatting = Formatting.Indented,
        Converters = [new StringEnumConverter()],
        ContractResolver = new RegisteredTypeContractResolver(JsonTypeSchemaBindingRegistry.Shared),
        NullValueHandling = NullValueHandling.Ignore
    };


    private readonly ModuleDocumentStorage _documents = documents ?? throw new ArgumentNullException(nameof(documents));

    public TSettings ReadRequired(string relativePath, string? rootKey = null) {
        var resolvedRootKey = rootKey ?? this._documents.DefaultRootKey;
        this.EnsureSynchronized(relativePath, resolvedRootKey);

        var snapshot = this._documents.OpenAsync(relativePath, true, resolvedRootKey).GetAwaiter().GetResult();
        if (!snapshot.Validation.IsValid) {
            throw new JsonValidationException(this._documents.ResolveDocumentPath(relativePath, resolvedRootKey),
                snapshot.Validation.Issues.Select(issue => $"{issue.Path}: {issue.Message}")
            );
        }

        var content = snapshot.ComposedContent ?? snapshot.RawContent;
        return JsonConvert.DeserializeObject<TSettings>(content, DeserializerSettings) ?? CreateDefaultValue();
    }

    public TSettings ReadOrDefault(string relativePath, string? rootKey = null) {
        try {
            return this.ReadRequired(relativePath, rootKey);
        } catch (FileNotFoundException) {
            return CreateDefaultValue();
        }
    }

    public string ResolveDocumentPath(string relativePath, string? rootKey = null) =>
        this._documents.ResolveDocumentPath(relativePath, rootKey);

    public ModuleDocumentStorage Documents() => this._documents;

    private void EnsureSynchronized(string relativePath, string rootKey) {
        var syncService =
            new SettingsDocumentSchemaSyncService(this._documents.RuntimeMode);
        var documentPath = this._documents.ResolveDocumentPath(relativePath, rootKey);
        var rootDirectory = this._documents.ResolveRootDirectory(rootKey);

        _ = syncService.EnsureSynchronized(typeof(TSettings), this._documents.StorageOptions,
            documentPath,
            rootDirectory
        );
    }

    private static TSettings CreateDefaultValue() {
        var serializerSettings = RevitJsonFormatting.CreateRevitIndentedSettings();
        var defaultValue = JsonConvert.DeserializeObject<TSettings>("{}", serializerSettings);
        if (defaultValue != null)
            return defaultValue;

        if (Activator.CreateInstance(typeof(TSettings)) is TSettings createdValue)
            return createdValue;

        throw new InvalidOperationException(
            $"Could not materialize a default settings value for '{typeof(TSettings).FullName}'."
        );
    }
}
