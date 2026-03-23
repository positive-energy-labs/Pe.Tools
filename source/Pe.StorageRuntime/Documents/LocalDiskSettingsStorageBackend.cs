using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime.Modules;
using Pe.StorageRuntime.PolyFill;

namespace Pe.StorageRuntime.Documents;

/// <summary>
///     Minimal shared filesystem backend over the existing Pe.App settings layout.
/// </summary>
public sealed class LocalDiskSettingsStorageBackend(
    string? basePath = null,
    SettingsRuntimeCapabilities? availableCapabilities = null,
    IReadOnlyDictionary<string, SettingsStorageModuleDefinition>? moduleDefinitionsByModuleKey = null
    ) : ISettingsStorageBackend {
    private readonly string _basePath = string.IsNullOrWhiteSpace(basePath)
            ? SettingsStorageLocations.GetDefaultBasePath()
            : Path.GetFullPath(basePath);
    private readonly SettingsRuntimeCapabilities _availableCapabilities =
        availableCapabilities ?? SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly;
    private readonly IReadOnlyDictionary<string, SettingsStorageModuleDefinition> _moduleDefinitionsByModuleKey =
            moduleDefinitionsByModuleKey ??
            new Dictionary<string, SettingsStorageModuleDefinition>(StringComparer.OrdinalIgnoreCase);

    public Task<SettingsDiscoveryResult> DiscoverAsync(
        string moduleKey,
        string rootKey,
        SettingsDiscoveryOptions options,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();

        options ??= new SettingsDiscoveryOptions();
        _ = this.ResolveRequiredModuleDefinition(moduleKey, rootKey);
        var rootDirectory = this.ResolveRootDirectory(moduleKey, rootKey);
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
            ? rootKey
            : normalizedRootRelativePath.Split('/').Last();

        if (!Directory.Exists(discoveryRootPath)) {
            return Task.FromResult(new SettingsDiscoveryResult(
                [],
                new SettingsDirectoryNode(rootName, normalizedRootRelativePath, [], [])
            ));
        }

        var searchOption = options.Recursive
            ? SearchOption.AllDirectories
            : SearchOption.TopDirectoryOnly;
        var files = Directory.EnumerateFiles(discoveryRootPath, "*.json", searchOption)
            .Select(path => SettingsDiscoveryBuilder.CreateSettingsFileEntry(path, rootDirectory))
            .Where(entry => options.IncludeFragments || !entry.IsFragment)
            .Where(entry => options.IncludeSchemas || !entry.IsSchema)
            .OrderByDescending(entry => entry.ModifiedUtc)
            .ToList();
        var tree = SettingsDiscoveryBuilder.BuildDirectoryTree(rootName, normalizedRootRelativePath, files);

        return Task.FromResult(new SettingsDiscoveryResult(files, tree));
    }

    public Task<SettingsDocumentSnapshot> OpenAsync(
        OpenSettingsDocumentRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(this.ReadSnapshot(request, request.IncludeComposedContent));
    }

    public Task<SettingsDocumentSnapshot> ComposeAsync(
        OpenSettingsDocumentRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(this.ReadSnapshot(request, true));
    }

    public Task<SaveSettingsDocumentResult> SaveAsync(
        SaveSettingsDocumentRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();

        var moduleDefinition = this.ResolveRequiredModuleDefinition(
            request.DocumentId.ModuleKey,
            request.DocumentId.RootKey
        );
        var documentPath = this.ResolveDocumentPath(request.DocumentId);
        var validation = this.ValidateCore(
            request.DocumentId,
            request.RawContent,
            moduleDefinition,
            includeComposedContent: true
        );
        var currentVersionToken = CreateVersionToken(documentPath);
        var conflictDetected = request.ExpectedVersionToken != null &&
                               currentVersionToken != null &&
                               !string.Equals(
                                   request.ExpectedVersionToken.Value.Value,
                                   currentVersionToken.Value.Value,
                                   StringComparison.Ordinal
                               );

        if (conflictDetected || !validation.IsValid) {
            return Task.FromResult(new SaveSettingsDocumentResult(
                this.BuildMetadata(request.DocumentId, documentPath),
                false,
                conflictDetected,
                conflictDetected
                    ? $"Settings document '{request.DocumentId.StableId}' changed on disk."
                    : null,
                validation
            ));
        }

        var directory = Path.GetDirectoryName(documentPath);
        if (!string.IsNullOrWhiteSpace(directory) && !Directory.Exists(directory))
            _ = Directory.CreateDirectory(directory);

        File.WriteAllText(documentPath, JsonFormatting.NormalizeTrailingNewline(request.RawContent));

        return Task.FromResult(new SaveSettingsDocumentResult(
            this.BuildMetadata(request.DocumentId, documentPath),
            true,
            false,
            null,
            validation
        ));
    }

    public Task<SettingsValidationResult> ValidateAsync(
        ValidateSettingsDocumentRequest request,
        CancellationToken cancellationToken = default
    ) {
        cancellationToken.ThrowIfCancellationRequested();
        var moduleDefinition = this.ResolveRequiredModuleDefinition(
            request.DocumentId.ModuleKey,
            request.DocumentId.RootKey
        );
        return Task.FromResult(this.ValidateCore(
            request.DocumentId,
            request.RawContent,
            moduleDefinition,
            includeComposedContent: true
        ));
    }

    private SettingsDocumentSnapshot ReadSnapshot(
        OpenSettingsDocumentRequest request,
        bool includeComposedOutput
    ) {
        var moduleDefinition = this.ResolveRequiredModuleDefinition(
            request.DocumentId.ModuleKey,
            request.DocumentId.RootKey
        );
        var documentPath = this.ResolveDocumentPath(request.DocumentId);
        if (!File.Exists(documentPath))
            throw new FileNotFoundException($"Settings document not found: {documentPath}", documentPath);

        var rawContent = File.ReadAllText(documentPath);
        var materialized = this.MaterializeDocument(
            request.DocumentId,
            rawContent,
            moduleDefinition,
            includeComposedOutput
        );

        return new SettingsDocumentSnapshot(
            this.BuildMetadata(request.DocumentId, documentPath),
            rawContent,
            materialized.ComposedContent,
            materialized.Dependencies,
            materialized.Validation,
            this.BuildCapabilityHints(includeComposedOutput, moduleDefinition)
        );
    }

    private MaterializedDocument MaterializeDocument(
        SettingsDocumentId documentId,
        string rawContent,
        SettingsStorageModuleDefinition moduleDefinition,
        bool includeComposedOutput
    ) {
        try {
            var rawObject = JObject.Parse(rawContent);
            return this.MaterializeDocument(documentId, rawContent, rawObject, moduleDefinition, includeComposedOutput);
        } catch (JsonReaderException ex) {
            return new MaterializedDocument(
                null,
                [],
                SettingsValidationResults.Error(
                    "$",
                    "JsonParseError",
                    ex.Message,
                    "Fix the JSON syntax and retry."
                )
            );
        }
    }

    private MaterializedDocument MaterializeDocument(
        SettingsDocumentId documentId,
        string rawContent,
        JObject rawObject,
        SettingsStorageModuleDefinition moduleDefinition,
        bool includeComposedOutput
    ) {
        var dependencies = new List<SettingsDocumentDependency>();
        string? composedContent = null;
        JObject? composedObject = null;
        List<SettingsValidationIssue> issues = [];

        try {
            if (ShouldRunCompositionPreflight(rawObject, moduleDefinition.StorageOptions)) {
                var pipeline = this.CreateCompositionPipeline(documentId, moduleDefinition);
                composedObject = pipeline.ComposeForRead(
                    (JObject)rawObject.DeepClone(),
                    artifact => dependencies.Add(this.CreateDependency(documentId, artifact, SettingsDocumentDependencyKind.Include)),
                    artifact => dependencies.Add(this.CreateDependency(documentId, artifact, SettingsDocumentDependencyKind.Preset))
                );
                if (includeComposedOutput)
                    composedContent = JsonFormatting.NormalizeTrailingNewline(composedObject.ToString(Formatting.Indented));
            }
        } catch (JsonCompositionException ex) {
            issues.Add(new SettingsValidationIssue(
                "$",
                "CompositionError",
                "error",
                ex.Message,
                "Fix the directive path or allowed root configuration."
            ));
        } catch (Exception ex) {
            issues.Add(new SettingsValidationIssue(
                "$",
                "CompositionFailure",
                "error",
                ex.Message,
                "Review the document directives and retry."
            ));
        }

        if (issues.Count == 0 && moduleDefinition.Validator != null) {
            var validatorResult = moduleDefinition.Validator.Validate(
                documentId,
                rawContent,
                composedObject == null ? null : JsonFormatting.NormalizeTrailingNewline(composedObject.ToString(Formatting.Indented))
            );
            issues.AddRange(validatorResult.Issues);
        }

        return new MaterializedDocument(
            composedContent,
            dependencies
                .Distinct()
                .ToList(),
            CreateValidationResult(issues)
        );
    }

    private SettingsValidationResult ValidateCore(
        SettingsDocumentId documentId,
        string rawContent,
        SettingsStorageModuleDefinition moduleDefinition,
        bool includeComposedContent
    ) {
        try {
            var rawObject = JObject.Parse(rawContent);
            return this.MaterializeDocument(
                documentId,
                rawContent,
                rawObject,
                moduleDefinition,
                includeComposedContent
            ).Validation;
        } catch (JsonReaderException ex) {
            return SettingsValidationResults.Error(
                "$",
                "JsonParseError",
                ex.Message,
                "Fix the JSON syntax and retry."
            );
        }
    }

    private JsonCompositionPipeline CreateCompositionPipeline(
        SettingsDocumentId documentId,
        SettingsStorageModuleDefinition moduleDefinition
    ) => new(
        this.ResolveRootDirectory(documentId.ModuleKey, documentId.RootKey),
        moduleDefinition.StorageOptions.IncludeRoots,
        moduleDefinition.StorageOptions.PresetRoots
    );

    private SettingsStorageModuleDefinition ResolveRequiredModuleDefinition(string moduleKey, string rootKey) {
        if (!this._moduleDefinitionsByModuleKey.TryGetValue(moduleKey, out var definition)) {
            throw new InvalidOperationException(
                $"Storage module '{moduleKey}' is not configured."
            );
        }

        if (definition.AllowedRootKeys.Count != 0 &&
            !definition.AllowedRootKeys.Contains(rootKey, StringComparer.OrdinalIgnoreCase)) {
            throw new InvalidOperationException(
                $"Storage root '{rootKey}' is not configured for module '{moduleKey}'."
            );
        }

        return definition;
    }

    private static bool ShouldRunCompositionPreflight(
        JToken token,
        SettingsStorageModuleOptions moduleOptions
    ) =>
        moduleOptions.IncludeRoots.Count != 0 ||
        moduleOptions.PresetRoots.Count != 0 ||
        ContainsDirectiveMetadata(token);

    private static bool ContainsDirectiveMetadata(JToken token) {
        if (token is JObject obj) {
            if (obj.Property("$include") != null || obj.Property("$preset") != null)
                return true;

            foreach (var property in obj.Properties()) {
                if (ContainsDirectiveMetadata(property.Value))
                    return true;
            }
        }

        if (token is JArray array) {
            foreach (var item in array) {
                if (item != null && ContainsDirectiveMetadata(item))
                    return true;
            }
        }

        return false;
    }

    private SettingsDocumentDependency CreateDependency(
        SettingsDocumentId sourceDocumentId,
        SettingsCompositionArtifact artifact,
        SettingsDocumentDependencyKind kind
    ) => new(
        this.CreateDependencyId(sourceDocumentId, artifact),
        artifact.DirectivePath,
        artifact.ResolvedDirective.Scope == SettingsPathing.DirectiveScope.Global
            ? SettingsDirectiveScope.Global
            : SettingsDirectiveScope.Local,
        kind
    );

    private SettingsDocumentId CreateDependencyId(
        SettingsDocumentId sourceDocumentId,
        SettingsCompositionArtifact artifact
    ) {
        var normalizedDependencyPath = Path.GetFullPath(artifact.SourceFilePath);
        if (artifact.ResolvedDirective.Scope == SettingsPathing.DirectiveScope.Global) {
            var globalFragmentsDirectory = SettingsPathing.TryResolveGlobalFragmentsDirectory(
                this.ResolveRootDirectory(sourceDocumentId.ModuleKey, sourceDocumentId.RootKey)
            ) ?? artifact.ResolvedDirective.RootDirectory;
            return new SettingsDocumentId(
                "Global",
                "fragments",
                BclExtensions.GetRelativePath(globalFragmentsDirectory, normalizedDependencyPath).Replace('\\', '/')
            );
        }

        return new SettingsDocumentId(
            sourceDocumentId.ModuleKey,
            sourceDocumentId.RootKey,
            BclExtensions.GetRelativePath(artifact.ResolvedDirective.RootDirectory, normalizedDependencyPath)
                .Replace('\\', '/')
        );
    }

    private SettingsDocumentMetadata BuildMetadata(
        SettingsDocumentId documentId,
        string documentPath
    ) {
        var kind = File.Exists(documentPath)
            ? SettingsDiscoveryBuilder.CreateSettingsFileEntry(
                documentPath,
                this.ResolveRootDirectory(documentId.ModuleKey, documentId.RootKey)
            ).Kind
            : SettingsFileKind.Profile;
        var modifiedUtc = File.Exists(documentPath)
            ? new DateTimeOffset(File.GetLastWriteTimeUtc(documentPath), TimeSpan.Zero)
            : (DateTimeOffset?)null;

        return new SettingsDocumentMetadata(
            documentId,
            kind,
            modifiedUtc,
            CreateVersionToken(documentPath)
        );
    }

    private IReadOnlyDictionary<string, string> BuildCapabilityHints(
        bool includeComposedContent,
        SettingsStorageModuleDefinition moduleDefinition
    ) => new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase) {
        ["backend"] = "local-disk",
        ["availableCapabilities"] = JsonConvert.SerializeObject(this._availableCapabilities.ToMetadata()),
        ["schemaValidation"] = moduleDefinition.Validator == null ? "not-configured" : "configured",
        ["compositionPolicy"] = includeComposedContent ? "module-scoped" : "not-requested",
        ["dependencyScopes"] = "local,global"
    };

    private string ResolveDocumentPath(SettingsDocumentId documentId) {
        var rootDirectory = this.ResolveRootDirectory(documentId.ModuleKey, documentId.RootKey);
        return SettingsPathing.ResolveSafeRelativeJsonPath(
            rootDirectory,
            documentId.RelativePath,
            nameof(documentId.RelativePath)
        );
    }

    private string ResolveRootDirectory(string moduleKey, string rootKey) =>
        SettingsStorageLocations.ResolveSettingsRootDirectory(this._basePath, moduleKey, rootKey);

    private static SettingsVersionToken? CreateVersionToken(string documentPath) {
        if (!File.Exists(documentPath))
            return null;

        var fileInfo = new FileInfo(documentPath);
        return new SettingsVersionToken($"{fileInfo.LastWriteTimeUtc.Ticks:x}-{fileInfo.Length:x}");
    }

    private static SettingsValidationResult CreateValidationResult(IReadOnlyList<SettingsValidationIssue> issues) {
        var hasErrors = issues.Any(issue => string.Equals(issue.Severity, "error", StringComparison.OrdinalIgnoreCase));
        return new SettingsValidationResult(!hasErrors, issues);
    }



    private sealed record MaterializedDocument(
        string? ComposedContent,
        IReadOnlyList<SettingsDocumentDependency> Dependencies,
        SettingsValidationResult Validation
    );
}
