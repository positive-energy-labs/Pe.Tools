using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Context;
using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal sealed class JsonCompositionSchemaSynchronizer(
    string schemaDirectory,
    IReadOnlyDictionary<string, Type> fragmentItemTypesByRoot,
    IReadOnlyDictionary<string, Type> presetObjectTypesByRoot,
    SettingsRuntimeCapabilities? capabilities = null,
    ISettingsDocumentContextAccessor? documentContextAccessor = null
) : ISettingsCompositionSchemaSynchronizer {
    private readonly SettingsRuntimeCapabilities _capabilities =
        capabilities ?? SettingsRuntimeCapabilityProfiles.LiveDocument;

    private readonly ISettingsDocumentContextAccessor? _documentContextAccessor = documentContextAccessor;
    private readonly IReadOnlyDictionary<string, Type> _fragmentItemTypesByRoot = fragmentItemTypesByRoot;
    private readonly Dictionary<string, JsonSchema> _fragmentSchemasByRoot = new(StringComparer.OrdinalIgnoreCase);
    private readonly IReadOnlyDictionary<string, Type> _presetObjectTypesByRoot = presetObjectTypesByRoot;
    private readonly Dictionary<string, JsonSchema> _presetSchemasByRoot = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _schemaDirectory = schemaDirectory;

    public void EnsureFragmentSchema(SettingsCompositionArtifact artifact) {
        if (!this._fragmentItemTypesByRoot.TryGetValue(artifact.ResolvedDirective.RootSegment, out var itemType)) {
            throw JsonCompositionException.InvalidIncludePath(
                artifact.DirectivePath,
                this._fragmentItemTypesByRoot.Keys
            );
        }

        var fragmentContent = File.ReadAllText(artifact.SourceFilePath);
        var fragmentSchemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            this._schemaDirectory,
            artifact.ResolvedDirective.Scope,
            false,
            artifact.ResolvedDirective.RootSegment
        );
        if (!this._fragmentSchemasByRoot.TryGetValue(artifact.ResolvedDirective.RootSegment, out var fragmentSchema)) {
            fragmentSchema = RevitJsonSchemaFactory.BuildFragmentSchema(
                itemType,
                this._capabilities,
                this._documentContextAccessor
            );
            this._fragmentSchemasByRoot[artifact.ResolvedDirective.RootSegment] = fragmentSchema;
        }

        if (TryParseObject(fragmentContent, out var fragmentObject))
            SchemaUiDocumentSynchronizer.Synchronize(fragmentSchema, fragmentObject);

        var updatedContent = JsonSchemaDocumentService.WriteSchemaAndInjectReference(
            fragmentSchema,
            fragmentObject?.ToString(Formatting.Indented) ?? fragmentContent,
            artifact.SourceFilePath,
            fragmentSchemaPath
        );
        updatedContent = JsonFormatting.NormalizeTrailingNewline(updatedContent);
        if (!string.Equals(fragmentContent, updatedContent, StringComparison.Ordinal))
            File.WriteAllText(artifact.SourceFilePath, updatedContent);
    }

    public void EnsurePresetSchema(SettingsCompositionArtifact artifact) {
        if (!this._presetObjectTypesByRoot.TryGetValue(artifact.ResolvedDirective.RootSegment, out var objectType)) {
            throw JsonCompositionException.InvalidPresetPath(
                artifact.DirectivePath,
                this._presetObjectTypesByRoot.Keys
            );
        }

        var presetContent = File.ReadAllText(artifact.SourceFilePath);
        var presetSchemaPath = SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            this._schemaDirectory,
            artifact.ResolvedDirective.Scope,
            true,
            artifact.ResolvedDirective.RootSegment
        );
        if (!this._presetSchemasByRoot.TryGetValue(artifact.ResolvedDirective.RootSegment, out var presetSchema)) {
            presetSchema = RevitJsonSchemaFactory.BuildAuthoringSchema(
                objectType,
                this._capabilities,
                this._documentContextAccessor
            );
            this._presetSchemasByRoot[artifact.ResolvedDirective.RootSegment] = presetSchema;
        }

        if (TryParseObject(presetContent, out var presetObject))
            SchemaUiDocumentSynchronizer.Synchronize(presetSchema, presetObject);

        var updatedContent = JsonSchemaDocumentService.WriteSchemaAndInjectReference(
            presetSchema,
            presetObject?.ToString(Formatting.Indented) ?? presetContent,
            artifact.SourceFilePath,
            presetSchemaPath
        );
        updatedContent = JsonFormatting.NormalizeTrailingNewline(updatedContent);
        if (!string.Equals(presetContent, updatedContent, StringComparison.Ordinal))
            File.WriteAllText(artifact.SourceFilePath, updatedContent);
    }

    private static bool TryParseObject(string jsonContent, out JObject? obj) {
        obj = null;
        try {
            obj = JObject.Parse(jsonContent);
            return true;
        } catch (JsonReaderException) {
            return false;
        }
    }
}