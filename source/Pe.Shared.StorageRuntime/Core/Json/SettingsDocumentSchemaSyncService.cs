using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Context;
using Pe.Shared.StorageRuntime.Json;
using Pe.Shared.StorageRuntime.Modules;

namespace Pe.Shared.StorageRuntime.Revit.Core.Json;

public sealed class SettingsDocumentSchemaSyncService(
    SettingsRuntimeMode runtimeMode = SettingsRuntimeMode.HostOnly,
    ISettingsDocumentContextAccessor? documentContextAccessor = null
) {
    private readonly SettingsRuntimeMode _runtimeMode = runtimeMode;
    private readonly ISettingsDocumentContextAccessor? _documentContextAccessor = documentContextAccessor;

    public string EnsureSynchronized(
        Type settingsType,
        SettingsStorageModuleOptions storageOptions,
        string documentPath,
        string schemaDirectory
    ) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));
        if (storageOptions == null)
            throw new ArgumentNullException(nameof(storageOptions));
        if (string.IsNullOrWhiteSpace(documentPath))
            throw new ArgumentException("Document path is required.", nameof(documentPath));
        if (string.IsNullOrWhiteSpace(schemaDirectory))
            throw new ArgumentException("Schema directory is required.", nameof(schemaDirectory));
        if (!File.Exists(documentPath))
            throw new FileNotFoundException("Settings document not found.", documentPath);

        var rawContent = File.ReadAllText(documentPath);
        var synchronizedContent = this.SynchronizeContent(
            settingsType,
            storageOptions,
            rawContent,
            documentPath,
            schemaDirectory
        );

        if (!string.Equals(rawContent, synchronizedContent, StringComparison.Ordinal))
            File.WriteAllText(documentPath, synchronizedContent);

        return synchronizedContent;
    }

    public string SynchronizeContent(
        Type settingsType,
        SettingsStorageModuleOptions storageOptions,
        string rawContent,
        string documentPath,
        string schemaDirectory
    ) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));
        if (storageOptions == null)
            throw new ArgumentNullException(nameof(storageOptions));
        if (string.IsNullOrWhiteSpace(documentPath))
            throw new ArgumentException("Document path is required.", nameof(documentPath));
        if (string.IsNullOrWhiteSpace(schemaDirectory))
            throw new ArgumentException("Schema directory is required.", nameof(schemaDirectory));
        if (string.IsNullOrWhiteSpace(rawContent) || settingsType == typeof(object))
            return rawContent;

        JObject rootObject;
        try {
            rootObject = JObject.Parse(rawContent);
        } catch (JsonReaderException) {
            return rawContent;
        }

        this.TrySynchronizeDirectiveArtifacts(settingsType, storageOptions, rootObject, schemaDirectory);
        return this.TryInjectProfileSchema(settingsType, rawContent, rootObject, documentPath, schemaDirectory);
    }

    public string SynchronizeContentForSave(
        Type settingsType,
        SettingsStorageModuleOptions storageOptions,
        string rawContent,
        string documentPath,
        string schemaDirectory
    ) {
        if (settingsType == null)
            throw new ArgumentNullException(nameof(settingsType));
        if (storageOptions == null)
            throw new ArgumentNullException(nameof(storageOptions));
        if (string.IsNullOrWhiteSpace(documentPath))
            throw new ArgumentException("Document path is required.", nameof(documentPath));
        if (string.IsNullOrWhiteSpace(schemaDirectory))
            throw new ArgumentException("Schema directory is required.", nameof(schemaDirectory));
        if (string.IsNullOrWhiteSpace(rawContent) || settingsType == typeof(object))
            return rawContent;

        JObject rootObject;
        try {
            rootObject = JObject.Parse(rawContent);
        } catch (JsonReaderException) {
            return rawContent;
        }

        this.TrySynchronizeDirectiveArtifacts(settingsType, storageOptions, rootObject, schemaDirectory);
        return this.TryInjectProfileSchema(
            settingsType,
            rawContent,
            rootObject,
            documentPath,
            schemaDirectory,
            true
        );
    }

    private void TrySynchronizeDirectiveArtifacts(
        Type settingsType,
        SettingsStorageModuleOptions storageOptions,
        JObject rootObject,
        string schemaDirectory
    ) {
        if (!ContainsDirectiveMetadata(rootObject))
            return;

        try {
            var metadata = SettingsSchemaSyncMetadataBuilder.Create(settingsType, storageOptions);
            var pipeline = new JsonCompositionPipeline(
                schemaDirectory,
                metadata.KnownIncludeRoots,
                metadata.KnownPresetRoots,
                new JsonCompositionSchemaSynchronizer(
                    schemaDirectory,
                    metadata.FragmentItemTypesByRoot,
                    metadata.PresetObjectTypesByRoot,
                    this._runtimeMode,
                    this._documentContextAccessor
                )
            );

            _ = pipeline.ComposeForRead((JObject)rootObject.DeepClone());
        } catch (JsonCompositionException) {
        } catch {
        }
    }

    private string TryInjectProfileSchema(
        Type settingsType,
        string rawContent,
        JObject rootObject,
        string documentPath,
        string schemaDirectory,
        bool pruneDefaults = false
    ) {
        try {
            var authoringSchema = RevitJsonSchemaFactory.BuildAuthoringSchema(
                settingsType,
                this._runtimeMode,
                this._documentContextAccessor
            );
            SchemaUiDocumentSynchronizer.Synchronize(authoringSchema, rootObject);
            if (pruneDefaults)
                SchemaDefaultDocumentPruner.Prune(authoringSchema, rootObject);
            var profileSchemaPath = SettingsPathing.ResolveCentralizedProfileSchemaPath(
                schemaDirectory,
                settingsType
            );
            var normalizedContent = rootObject.ToString(Formatting.Indented);
            var updatedContent = JsonSchemaDocumentService.WriteSchemaAndInjectReference(
                authoringSchema,
                normalizedContent,
                documentPath,
                profileSchemaPath
            );
            return JsonFormatting.NormalizeTrailingNewline(updatedContent);
        } catch {
            return rawContent;
        }
    }

    private static bool ContainsDirectiveMetadata(JToken token) {
        if (token is JObject obj) {
            if (obj.Property("$include") != null || obj.Property("$preset") != null)
                return true;

            foreach (var property in obj.Properties())
                if (ContainsDirectiveMetadata(property.Value))
                    return true;

            return false;
        }

        if (token is JArray array)
            return array.Any(ContainsDirectiveMetadata);

        return false;
    }
}
