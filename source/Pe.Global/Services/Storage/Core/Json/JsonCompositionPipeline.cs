using Newtonsoft.Json.Linq;
using NJsonSchema;
using Pe.Global.Services.Storage.Core;

namespace Pe.Global.Services.Storage.Core.Json;

internal sealed class JsonCompositionPipeline {
    private readonly string _schemaDirectory;
    private readonly JsonBehavior _behavior;
    private readonly string? _globalFragmentsDirectory;
    private readonly IReadOnlyDictionary<string, Type> _fragmentItemTypesByRoot;
    private readonly IReadOnlyDictionary<string, Type> _presetObjectTypesByRoot;
    private readonly HashSet<string> _knownIncludeRoots;
    private readonly HashSet<string> _knownPresetRoots;

    public JsonCompositionPipeline(
        string schemaDirectory,
        JsonBehavior behavior,
        IReadOnlyDictionary<string, Type> fragmentItemTypesByRoot,
        IReadOnlyDictionary<string, Type> presetObjectTypesByRoot,
        IEnumerable<string> knownIncludeRoots,
        IEnumerable<string> knownPresetRoots
    ) {
        this._schemaDirectory = schemaDirectory;
        this._behavior = behavior;
        this._globalFragmentsDirectory = SettingsPathing.TryResolveGlobalFragmentsDirectory(schemaDirectory);
        this._fragmentItemTypesByRoot = fragmentItemTypesByRoot;
        this._presetObjectTypesByRoot = presetObjectTypesByRoot;
        this._knownIncludeRoots = SettingsPathing.NormalizeAllowedRoots(knownIncludeRoots);
        this._knownPresetRoots = SettingsPathing.NormalizeAllowedRoots(knownPresetRoots);
    }

    public JObject ComposeForRead(JObject root) {
        if (this._behavior == JsonBehavior.Output)
            return root;

        var touchedFragments = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fragmentSchemasByRoot = new Dictionary<string, JsonSchema>(StringComparer.OrdinalIgnoreCase);
        var touchedPresets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var presetSchemasByRoot = new Dictionary<string, JsonSchema>(StringComparer.OrdinalIgnoreCase);

        root = JsonPresetComposer.ExpandPresets(
            root,
            this._schemaDirectory,
            this._knownPresetRoots,
            (presetPath, includePath) =>
                this.RewritePresetSchema(presetPath, includePath, touchedPresets, presetSchemasByRoot),
            this._globalFragmentsDirectory
        );
        root = JsonArrayComposer.ExpandIncludes(
            root,
            this._schemaDirectory,
            this._knownIncludeRoots,
            (fragmentPath, includePath) =>
                this.RewriteIncludedFragmentSchema(fragmentPath, includePath, touchedFragments, fragmentSchemasByRoot),
            this._globalFragmentsDirectory
        );

        return root;
    }

    private void RewriteIncludedFragmentSchema(
        string fragmentPath,
        string includePath,
        HashSet<string> touchedFragments,
        Dictionary<string, JsonSchema> fragmentSchemasByRoot
    ) {
        if (this._behavior == JsonBehavior.Output)
            return;
        if (!touchedFragments.Add(fragmentPath))
            return;

        var resolvedDirective = this.ResolveIncludeDirective(includePath);
        var rootSegment = resolvedDirective.RootSegment;

        _ = this._fragmentItemTypesByRoot.TryGetValue(rootSegment, out var itemType);
        if (itemType == null)
            throw JsonCompositionException.InvalidIncludePath(includePath, this._fragmentItemTypesByRoot.Keys);

        var fragmentContent = File.ReadAllText(fragmentPath);

        var fragmentSchemaPath = this.ResolveSchemaPathForDirective(
            resolvedDirective,
            includePath,
            this._fragmentItemTypesByRoot.Keys,
            isPresetDirective: false
        );
        if (!fragmentSchemasByRoot.TryGetValue(rootSegment, out var fragmentSchema)) {
            fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(itemType, out var fragmentExamplesProcessor);
            fragmentExamplesProcessor.Finalize(fragmentSchema);
            fragmentSchemasByRoot[rootSegment] = fragmentSchema;
        }

        var updatedContent = JsonSchemaFactory.WriteAndInjectSchema(
            fragmentSchema,
            fragmentContent,
            fragmentPath,
            fragmentSchemaPath
        );
        updatedContent = EnsureTrailingNewline(updatedContent);
        if (!string.Equals(fragmentContent, updatedContent, StringComparison.Ordinal))
            File.WriteAllText(fragmentPath, updatedContent);
    }

    private void RewritePresetSchema(
        string presetPath,
        string includePath,
        HashSet<string> touchedPresets,
        Dictionary<string, JsonSchema> presetSchemasByRoot
    ) {
        if (this._behavior == JsonBehavior.Output)
            return;
        if (!touchedPresets.Add(presetPath))
            return;

        var resolvedDirective = this.ResolvePresetDirective(includePath);
        var rootSegment = resolvedDirective.RootSegment;

        _ = this._presetObjectTypesByRoot.TryGetValue(rootSegment, out var objectType);
        if (objectType == null)
            throw JsonCompositionException.InvalidPresetPath(includePath, this._presetObjectTypesByRoot.Keys);

        var presetContent = File.ReadAllText(presetPath);

        var presetSchemaPath = this.ResolveSchemaPathForDirective(
            resolvedDirective,
            includePath,
            this._presetObjectTypesByRoot.Keys,
            isPresetDirective: true
        );
        if (!presetSchemasByRoot.TryGetValue(rootSegment, out var presetSchema)) {
            presetSchema = JsonSchemaFactory.CreateAuthoringSchema(objectType, out var presetExamplesProcessor);
            presetExamplesProcessor.Finalize(presetSchema);
            presetSchemasByRoot[rootSegment] = presetSchema;
        }

        var updatedContent = JsonSchemaFactory.WriteAndInjectSchema(
            presetSchema,
            presetContent,
            presetPath,
            presetSchemaPath
        );
        updatedContent = EnsureTrailingNewline(updatedContent);
        if (!string.Equals(presetContent, updatedContent, StringComparison.Ordinal))
            File.WriteAllText(presetPath, updatedContent);
    }

    private string ResolveSchemaPathForDirective(
        SettingsPathing.ResolvedDirective resolvedDirective,
        string includePath,
        IEnumerable<string> allowedRoots,
        bool isPresetDirective
    ) {
        if (resolvedDirective.Scope == SettingsPathing.DirectiveScope.Global &&
            string.IsNullOrWhiteSpace(this._globalFragmentsDirectory))
            throw isPresetDirective
                ? JsonCompositionException.InvalidPresetPath(includePath, allowedRoots)
                : JsonCompositionException.InvalidIncludePath(includePath, allowedRoots);

        return SettingsPathing.ResolveCentralizedFragmentSchemaPath(
            this._schemaDirectory,
            resolvedDirective.Scope,
            isPresetDirective,
            resolvedDirective.RootSegment
        );
    }

    private SettingsPathing.ResolvedDirective ResolveIncludeDirective(string includePath) {
        try {
            return SettingsPathing.ResolveDirectivePath(
                includePath,
                this._schemaDirectory,
                this._globalFragmentsDirectory,
                this._knownIncludeRoots,
                nameof(includePath),
                requireGlobalAllowedRoot: true
            );
        } catch (ArgumentException) {
            throw JsonCompositionException.InvalidIncludePath(includePath, this._fragmentItemTypesByRoot.Keys);
        }
    }

    private SettingsPathing.ResolvedDirective ResolvePresetDirective(string includePath) {
        try {
            return SettingsPathing.ResolveDirectivePath(
                includePath,
                this._schemaDirectory,
                this._globalFragmentsDirectory,
                this._knownPresetRoots,
                nameof(includePath),
                requireGlobalAllowedRoot: false
            );
        } catch (ArgumentException) {
            throw JsonCompositionException.InvalidPresetPath(includePath, this._presetObjectTypesByRoot.Keys);
        }
    }

    private static string EnsureTrailingNewline(string jsonContent) =>
        jsonContent.TrimEnd('\r', '\n') + Environment.NewLine;

}
