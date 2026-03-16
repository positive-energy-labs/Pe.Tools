using NJsonSchema;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;

namespace Pe.StorageRuntime.Revit.Core.Json;

internal sealed class JsonCompositionSchemaSynchronizer(
    string schemaDirectory,
    IReadOnlyDictionary<string, Type> fragmentItemTypesByRoot,
    IReadOnlyDictionary<string, Type> presetObjectTypesByRoot
) : ISettingsCompositionSchemaSynchronizer {
    private readonly IReadOnlyDictionary<string, Type> _fragmentItemTypesByRoot = fragmentItemTypesByRoot;
    private readonly Dictionary<string, JsonSchema> _fragmentSchemasByRoot = new(StringComparer.OrdinalIgnoreCase);
    private readonly IReadOnlyDictionary<string, Type> _presetObjectTypesByRoot = presetObjectTypesByRoot;
    private readonly Dictionary<string, JsonSchema> _presetSchemasByRoot = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _schemaDirectory = schemaDirectory;
    private readonly SettingsRuntimeCapabilities _capabilities = SettingsRuntimeCapabilityProfiles.LiveDocument;

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
            fragmentSchema = RevitJsonSchemaFactory.BuildFragmentSchema(itemType, this._capabilities);
            this._fragmentSchemasByRoot[artifact.ResolvedDirective.RootSegment] = fragmentSchema;
        }

        var updatedContent = JsonSchemaDocumentService.WriteSchemaAndInjectReference(
            fragmentSchema,
            fragmentContent,
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
            presetSchema = RevitJsonSchemaFactory.BuildAuthoringSchema(objectType, this._capabilities);
            this._presetSchemasByRoot[artifact.ResolvedDirective.RootSegment] = presetSchema;
        }

        var updatedContent = JsonSchemaDocumentService.WriteSchemaAndInjectReference(
            presetSchema,
            presetContent,
            artifact.SourceFilePath,
            presetSchemaPath
        );
        updatedContent = JsonFormatting.NormalizeTrailingNewline(updatedContent);
        if (!string.Equals(presetContent, updatedContent, StringComparison.Ordinal))
            File.WriteAllText(artifact.SourceFilePath, updatedContent);
    }
}
