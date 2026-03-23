using Newtonsoft.Json.Linq;

namespace Pe.StorageRuntime.Json;

public readonly record struct SettingsCompositionArtifact(
    string SourceFilePath,
    string DirectivePath,
    SettingsPathing.ResolvedDirective ResolvedDirective,
    string SchemaContextDirectory
);

public interface ISettingsCompositionSchemaSynchronizer {
    void EnsureFragmentSchema(SettingsCompositionArtifact artifact);

    void EnsurePresetSchema(SettingsCompositionArtifact artifact);
}

public sealed class JsonCompositionPipeline {
    private readonly string? _globalFragmentsDirectory;
    private readonly HashSet<string> _knownIncludeRoots;
    private readonly HashSet<string> _knownPresetRoots;
    private readonly string _schemaDirectory;
    private readonly ISettingsCompositionSchemaSynchronizer? _schemaSynchronizer;

    public JsonCompositionPipeline(
        string schemaDirectory,
        IEnumerable<string> knownIncludeRoots,
        IEnumerable<string> knownPresetRoots,
        ISettingsCompositionSchemaSynchronizer? schemaSynchronizer = null
    ) {
        this._schemaDirectory = schemaDirectory;
        this._globalFragmentsDirectory = SettingsPathing.TryResolveGlobalFragmentsDirectory(schemaDirectory);
        this._knownIncludeRoots = SettingsPathing.NormalizeAllowedRoots(knownIncludeRoots);
        this._knownPresetRoots = SettingsPathing.NormalizeAllowedRoots(knownPresetRoots);
        this._schemaSynchronizer = schemaSynchronizer;
    }

    public JObject ComposeForRead(JObject root) =>
        this.ComposeForRead(root, null, null);

    public JObject ComposeForRead(
        JObject root,
        Action<SettingsCompositionArtifact>? onFragmentResolved,
        Action<SettingsCompositionArtifact>? onPresetResolved
    ) {
        root = JsonPresetComposer.ExpandPresets(
            root,
            this._schemaDirectory,
            this._knownPresetRoots,
            (presetPath, includePath) => this.OnPresetResolved(presetPath, includePath, onPresetResolved),
            this._globalFragmentsDirectory
        );
        root = JsonArrayComposer.ExpandIncludes(
            root,
            this._schemaDirectory,
            this._knownIncludeRoots,
            (fragmentPath, includePath) => this.OnFragmentResolved(fragmentPath, includePath, onFragmentResolved),
            this._globalFragmentsDirectory
        );

        return root;
    }

    private void OnFragmentResolved(
        string fragmentPath,
        string includePath,
        Action<SettingsCompositionArtifact>? onFragmentResolved
    ) {
        var resolvedDirective = this.ResolveIncludeDirective(includePath);
        var artifact = new SettingsCompositionArtifact(
            fragmentPath,
            includePath,
            resolvedDirective,
            this._schemaDirectory
        );

        this._schemaSynchronizer?.EnsureFragmentSchema(artifact);
        onFragmentResolved?.Invoke(artifact);
    }

    private void OnPresetResolved(
        string presetPath,
        string includePath,
        Action<SettingsCompositionArtifact>? onPresetResolved
    ) {
        var resolvedDirective = this.ResolvePresetDirective(includePath);
        var artifact = new SettingsCompositionArtifact(
            presetPath,
            includePath,
            resolvedDirective,
            this._schemaDirectory
        );

        this._schemaSynchronizer?.EnsurePresetSchema(artifact);
        onPresetResolved?.Invoke(artifact);
    }

    private SettingsPathing.ResolvedDirective ResolveIncludeDirective(string includePath) {
        try {
            return SettingsPathing.ResolveDirectivePath(
                includePath,
                this._schemaDirectory,
                this._globalFragmentsDirectory,
                this._knownIncludeRoots,
                nameof(includePath),
                true
            );
        } catch (ArgumentException) {
            throw JsonCompositionException.InvalidIncludePath(includePath, this._knownIncludeRoots);
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
                false
            );
        } catch (ArgumentException) {
            throw JsonCompositionException.InvalidPresetPath(includePath, this._knownPresetRoots);
        }
    }
}