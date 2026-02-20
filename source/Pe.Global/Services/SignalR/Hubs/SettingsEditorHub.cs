using Microsoft.AspNetCore.SignalR;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Pe.Global.Services.Aps.Models;
using Pe.Global.Services.Storage.Core;
using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using Pe.Global.Services.Storage.Modules;
using Serilog;
using System.Reflection;

namespace Pe.Global.Services.SignalR.Hubs;

/// <summary>
///     Unified SignalR hub for settings schema and file operations.
/// </summary>
public class SettingsEditorHub : Hub {
    private static readonly TimeSpan ExamplesThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly RevitTaskQueue _taskQueue;
    private readonly EndpointThrottleGate _throttleGate;

    public SettingsEditorHub(
        RevitTaskQueue taskQueue,
        SettingsModuleRegistry moduleRegistry,
        EndpointThrottleGate throttleGate
    ) {
        this._taskQueue = taskQueue;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    public override async Task OnConnectedAsync() {
        HubConnectionTracker.Add(this.Context.ConnectionId);
        Log.Debug(
            "SettingsEditorHub connected: ConnectionId={ConnectionId}, ActiveConnections={ActiveConnections}",
            this.Context.ConnectionId,
            HubConnectionTracker.ActiveConnectionCount
        );
        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception) {
        HubConnectionTracker.Remove(this.Context.ConnectionId);
        Log.Debug(
            "SettingsEditorHub disconnected: ConnectionId={ConnectionId}, ActiveConnections={ActiveConnections}",
            this.Context.ConnectionId,
            HubConnectionTracker.ActiveConnectionCount
        );
        await base.OnDisconnectedAsync(exception);
    }

    public async Task<SchemaEnvelopeResponse> GetSchemaEnvelope(SchemaRequest request) {
        var result = await this.GetSchemaCore(request);
        return result.ToSchemaEnvelope();
    }

    public async Task<ExamplesEnvelopeResponse> GetExamplesEnvelope(ExamplesRequest request) {
        var key = BuildThrottleKey(
            this.Context.ConnectionId,
            "examples",
            request.ModuleKey,
            request.PropertyPath,
            request.SiblingValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ExamplesThrottleWindow,
            async () => {
                var result = await this.GetExamplesCore(request);
                return result.ToExamplesEnvelope();
            }
        );
        LogThrottleDecision(nameof(GetExamplesEnvelope), decision, request.ModuleKey, request.PropertyPath);
        return response;
    }

    public async Task<ValidationEnvelopeResponse> ValidateSettingsEnvelope(ValidateSettingsRequest request) {
        var result = await this.ValidateSettingsCore(request);
        return result.ToValidationEnvelope();
    }

    public async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogEnvelope(ParameterCatalogRequest request) {
        var key = BuildThrottleKey(
            this.Context.ConnectionId,
            "parameter-catalog",
            request.ModuleKey,
            null,
            request.SiblingValues
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ParameterCatalogThrottleWindow,
            () => this.GetParameterCatalogCore(request)
        );
        LogThrottleDecision(nameof(GetParameterCatalogEnvelope), decision, request.ModuleKey, null);
        return response;
    }

    private async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var doc = uiApp.ActiveUIDocument?.Document;
                if (doc == null)
                    return HubResult
                        .Failure<ParameterCatalogData>(
                            EnvelopeCode.NoDocument,
                            "No active document.",
                            [
                                new ValidationIssue(
                                    "$",
                                    null,
                                    "NoActiveDocument",
                                    "error",
                                    "No active document.",
                                    "Open a Revit document and retry."
                                )
                            ]
                        )
                        .ToParameterCatalogEnvelope();

                var selectedFamilies = ParseSelectedFamilyNames(request.SiblingValues);
                var collected = ProjectFamilyParameterCollector.Collect(doc, selectedFamilies);
                var apsGuids = LoadApsParameterGuids();

                var entries = collected
                    .Select(entry => new ParameterCatalogEntry(
                        Name: entry.Name,
                        StorageType: entry.StorageType.ToString(),
                        DataType: entry.DataType.TypeId,
                        IsShared: entry.IsShared,
                        IsInstance: entry.IsInstance,
                        IsBuiltIn: entry.IsBuiltIn,
                        IsProjectParameter: entry.IsProjectParameter,
                        IsParamService: entry.IsShared && entry.SharedGuid.HasValue && apsGuids.Contains(entry.SharedGuid.Value),
                        SharedGuid: entry.SharedGuid?.ToString(),
                        FamilyNames: entry.FamilyNames.OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList(),
                        TypeNames: entry.ValuesPerType.Keys.OrderBy(n => n, StringComparer.Ordinal).ToList()
                    ))
                    .ToList();

                var familyCount = entries.SelectMany(e => e.FamilyNames).Distinct(StringComparer.OrdinalIgnoreCase).Count();
                var typeCount = entries.SelectMany(e => e.TypeNames).Distinct(StringComparer.Ordinal).Count();

                return HubResult
                    .Success(
                        new ParameterCatalogData(entries, familyCount, typeCount),
                        EnvelopeCode.Ok,
                        $"Collected {entries.Count} parameter entries across {familyCount} families."
                    )
                    .ToParameterCatalogEnvelope();
            } catch (Exception ex) {
                return HubResult
                    .Failure<ParameterCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HubResult.ExceptionIssue(
                                "ParameterCatalogException",
                                ex,
                                "Verify selected families and active document state."
                            )
                        ]
                    )
                    .ToParameterCatalogEnvelope();
            }
        });

    private SettingsListData ListSettingsCore(ListSettingsRequest request) {
        var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
        var settingsDir = module.SettingsDir();
        var discovered = settingsDir.Discover(
            new SettingsDiscoveryOptions(
                SubDirectory: null,
                request.Recursive,
                request.IncludeFragments,
                IncludeSchemas: true
            )
        );
        var files = discovered.Files
            .Select(file => new SettingsFileTreeNode(
                file.Name,
                file.RelativePath,
                file.RelativePathWithoutExtension,
                file.RelativePathWithoutExtension,
                file.ModifiedUtc,
                file.IsFragment,
                file.IsSchema
            ))
            .ToList();
        return new SettingsListData(files, MapDirectoryTree(discovered.Root));
    }

    private SettingsCatalogData BuildSettingsCatalogCore(SettingsCatalogRequest request) {
        var targets = this._moduleRegistry.GetModules()
            .Where(module =>
                string.IsNullOrWhiteSpace(request.ModuleKey) ||
                module.ModuleKey.Equals(request.ModuleKey, StringComparison.OrdinalIgnoreCase))
            .OrderBy(module => module.ModuleKey)
            .Select(module => new SettingsCatalogItem(
                module.ModuleKey,
                $"{module.ModuleKey} / {module.SettingsTypeName} / {module.DefaultSubDirectory}",
                module.ModuleKey,
                module.DefaultSubDirectory
            ))
            .ToList();
        return new SettingsCatalogData(targets);
    }

    public Task<SettingsCatalogEnvelopeResponse> GetSettingsCatalogEnvelope(SettingsCatalogRequest request) {
        try {
            var data = this.BuildSettingsCatalogCore(request);
            return Task.FromResult(
                HubResult
                    .Success(
                        data,
                        EnvelopeCode.Ok,
                        $"Found {data.Targets.Count} settings targets."
                    )
                    .ToSettingsCatalogEnvelope()
            );
        } catch (Exception ex) {
            return Task.FromResult(
                HubResult
                    .Failure<SettingsCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HubResult.ExceptionIssue(
                                "GetSettingsCatalogException",
                                ex,
                                "Verify module registration and settings contract metadata."
                            )
                        ]
                    )
                    .ToSettingsCatalogEnvelope()
            );
        }
    }

    public Task<SettingsListEnvelopeResponse> ListSettingsEnvelope(ListSettingsRequest request) {
        try {
            Log.Debug(
                "SettingsEditorHub.ListSettingsEnvelope requested: ModuleKey={ModuleKey}, Recursive={Recursive}, IncludeFragments={IncludeFragments}",
                request.ModuleKey,
                request.Recursive,
                request.IncludeFragments
            );
            var data = this.ListSettingsCore(request);
            Log.Information(
                "SettingsEditorHub.ListSettingsEnvelope succeeded: ModuleKey={ModuleKey}, FileCount={FileCount}",
                request.ModuleKey,
                data.Files.Count
            );
            var result = HubResult
                .Success(
                    data,
                    EnvelopeCode.Ok,
                    $"Found {data.Files.Count} settings files."
                )
                .ToSettingsListEnvelope();
            return Task.FromResult(result);
        } catch (Exception ex) {
            Log.Error(
                ex,
                "SettingsEditorHub.ListSettingsEnvelope failed: ModuleKey={ModuleKey}",
                request.ModuleKey
            );
            var result = HubResult
                .Failure<SettingsListData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "ListSettingsException",
                            ex,
                            "Verify module registration and storage path."
                        )
                    ]
                )
                .ToSettingsListEnvelope();
            return Task.FromResult(result);
        }
    }

    public async Task<SettingsReadEnvelopeResponse> ReadSettingsEnvelope(ReadSettingsRequest request) {
        try {
            var result = await this.ReadSettingsCore(request);
            return result.ToSettingsReadEnvelope();
        } catch (Exception ex) {
            Log.Error(
                ex,
                "SettingsEditorHub.ReadSettingsEnvelope failed: ModuleKey={ModuleKey}, RelativePath={RelativePath}",
                request.ModuleKey,
                request.RelativePath
            );
            return HubResult
                .Failure<SettingsReadData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "ReadSettingsException",
                            ex,
                            "Check file name and module settings path."
                        )
                    ]
                )
                .ToSettingsReadEnvelope();
        }
    }

    public async Task<SettingsWriteEnvelopeResponse> WriteSettingsEnvelope(WriteSettingsRequest request) {
        try {
            var result = await this.WriteSettingsCore(request);
            return result.ToSettingsWriteEnvelope();
        } catch (Exception ex) {
            return HubResult
                .Failure<object?>(
                    EnvelopeCode.Exception,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "WriteSettingsException",
                            ex,
                            "Check file permissions and payload validity."
                        )
                    ]
                )
                .ToSettingsWriteEnvelope();
        }
    }

    private async Task<HubResult<SchemaData>> GetSchemaCore(SchemaRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
                var type = module.SettingsType;
                var targetSchemaJson = JsonSchemaFactory.CreateRenderSchemaJson(type, out _);

                string? fragmentSchemaJson = null;
                try {
                    var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(type, out var fragProcessor);
                    if (fragmentSchema != null) {
                        fragProcessor.Finalize(fragmentSchema);
                        fragmentSchemaJson = RenderSchemaTransformer.TransformFragmentToJson(fragmentSchema, type);
                    }
                } catch (Exception ex) {
                    Log.Warning(
                        ex,
                        "Fragment schema generation failed: ModuleKey={ModuleKey}, SettingsType={SettingsType}",
                        module.ModuleKey,
                        type.FullName ?? type.Name
                    );
                }

                return HubResult.Success(
                    new SchemaData(targetSchemaJson, fragmentSchemaJson),
                    EnvelopeCode.Ok,
                    "Schema generated."
                );
            } catch (Exception ex) {
                return HubResult.Failure<SchemaData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "SchemaException",
                            ex,
                            "Ensure module registration and schema processors are valid."
                        )
                    ]
                );
            }
        });

    private async Task<HubResult<ValidationData>> ValidateSettingsCore(ValidateSettingsRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var schema = JsonSchemaFactory.CreateAuthoringSchema(type, out var examplesProcessor);
                examplesProcessor.Finalize(schema);

                var issues = ValidationIssueMapper.ToValidationIssues(schema.Validate(request.SettingsJson)).ToList();

                return HubResult.Success(
                    new ValidationData(issues.Count == 0, issues),
                    EnvelopeCode.Ok,
                    issues.Count == 0 ? "Validation passed." : "Validation returned issues.",
                    issues
                );
            } catch (Exception ex) {
                var issues = new List<ValidationIssue> {
                    new(
                        "$",
                        null,
                        "ValidationException",
                        "error",
                        ex.Message,
                        "Ensure moduleKey is registered and settingsJson is valid JSON."
                    )
                };
                return HubResult.Failure<ValidationData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    issues
                ) with { Data = new ValidationData(false, issues) };
            }
        });

    private async Task<HubResult<ExamplesData>> GetExamplesCore(ExamplesRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var property = ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return HubResult.Success(
                        new ExamplesData([]),
                        EnvelopeCode.Ok,
                        "Property not found for examples provider."
                    );

                var providerAttr = property.GetCustomAttribute<SchemaExamplesAttribute>();
                if (providerAttr == null)
                    return HubResult.Success(
                        new ExamplesData([]),
                        EnvelopeCode.Ok,
                        "No examples provider configured for property."
                    );

                var provider = Activator.CreateInstance(providerAttr.ProviderType) as IOptionsProvider;
                if (provider == null)
                    return HubResult.Failure<ExamplesData>(
                        EnvelopeCode.Failed,
                        $"Failed to create provider '{providerAttr.ProviderType.Name}'.",
                        [
                            new ValidationIssue(
                                "$",
                                null,
                                "ProviderCreationFailed",
                                "error",
                                $"Failed to create provider '{providerAttr.ProviderType.Name}'.",
                                "Ensure provider has a public parameterless constructor."
                            )
                        ]
                    ) with { Data = new ExamplesData([]) };

                if (provider is IDependentOptionsProvider dependentProvider &&
                    request.SiblingValues is { Count: > 0 }) {
                    var dependentExamples = dependentProvider.GetExamples(request.SiblingValues).ToList();
                    return HubResult.Success(
                        new ExamplesData(dependentExamples),
                        EnvelopeCode.Ok,
                        $"Retrieved {dependentExamples.Count} examples."
                    );
                }

                var examples = provider.GetExamples().ToList();
                return HubResult.Success(
                    new ExamplesData(examples),
                    EnvelopeCode.Ok,
                    $"Retrieved {examples.Count} examples."
                );
            } catch (Exception ex) {
                Log.Error(ex, "GetExamples failed for property '{PropertyPath}'", request.PropertyPath);
                return HubResult.Failure<ExamplesData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HubResult.ExceptionIssue(
                            "ExamplesException",
                            ex,
                            "Check provider configuration and request path."
                        )
                    ]
                ) with { Data = new ExamplesData([]) };
            }
        });

    private async Task<HubResult<SettingsReadData>> ReadSettingsCore(ReadSettingsRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            Log.Debug(
                "SettingsEditorHub.ReadSettingsCore requested: ModuleKey={ModuleKey}, RelativePath={RelativePath}, ResolveComposition={ResolveComposition}",
                request.ModuleKey,
                request.RelativePath,
                request.ResolveComposition
            );
            var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
            var settingsDir = module.SettingsDir();
            string filePath;
            try {
                filePath = settingsDir.ResolveSafeRelativeJsonPath(request.RelativePath);
            } catch (ArgumentException ex) {
                Log.Warning(
                    "SettingsEditorHub.ReadSettingsCore invalid relative path: ModuleKey={ModuleKey}, RelativePath={RelativePath}",
                    request.ModuleKey,
                    request.RelativePath
                );
                return HubResult.Failure<SettingsReadData>(
                    EnvelopeCode.Failed,
                    "Invalid relative path.",
                    [
                        new ValidationIssue(
                            "$",
                            null,
                            "InvalidRelativePath",
                            "error",
                            ex.Message,
                            "Provide a valid relative path under the settings root."
                        )
                    ]
                ) with { Data = new SettingsReadData("", "") };
            }
            Log.Debug(
                "SettingsEditorHub.ReadSettingsCore resolved file path: {FilePath}",
                filePath
            );

            if (!File.Exists(filePath)) {
                Log.Warning(
                    "SettingsEditorHub.ReadSettingsCore file not found: {FilePath}",
                    filePath
                );
                return HubResult.Failure<SettingsReadData>(
                    EnvelopeCode.Failed,
                    $"File not found: {request.RelativePath}.json",
                    [
                        new ValidationIssue(
                            "$",
                            null,
                            "FileNotFound",
                            "error",
                            $"File not found: {request.RelativePath}.json",
                            "Select an existing settings file."
                        )
                    ]
                ) with { Data = new SettingsReadData("", "") };
            }

            var rawJson = File.ReadAllText(filePath);
            var resolvedJson = rawJson;
            var issues = new List<ValidationIssue>();
            CompositionMetadata? compositionMetadata = null;

            if (request.ResolveComposition) {
                var fileDirectoryPath = Path.GetDirectoryName(filePath) ?? settingsDir.DirectoryPath;
                var compositionBases = BuildCompositionBaseCandidates(fileDirectoryPath, settingsDir.DirectoryPath);
                Exception? lastCompositionException = null;
                string? resolvedBase = null;

                foreach (var candidateBase in compositionBases) {
                    try {
                        var jObject = JObject.Parse(rawJson);
                        JsonArrayComposer.ExpandIncludes(jObject, candidateBase, candidateBase);
                        _ = jObject.Remove("$schema");
                        resolvedJson = jObject.ToString(Formatting.Indented);
                        resolvedBase = candidateBase;
                        compositionMetadata = new CompositionMetadata(
                            IsComposed: true,
                            SourceMap: []
                        );
                        break;
                    } catch (Exception ex) {
                        lastCompositionException = ex;
                        Log.Warning(
                            ex,
                            "SettingsEditorHub.ReadSettingsCore composition resolution failed for base: {FilePath}, BasePath={BasePath}",
                            filePath,
                            candidateBase
                        );
                    }
                }

                if (!string.IsNullOrWhiteSpace(resolvedBase)) {
                    if (!string.Equals(resolvedBase, fileDirectoryPath, StringComparison.OrdinalIgnoreCase)) {
                        Log.Information(
                            "SettingsEditorHub.ReadSettingsCore composition resolved via fallback base: {FilePath}, PrimaryBase={PrimaryBase}, ResolvedBase={ResolvedBase}",
                            filePath,
                            fileDirectoryPath,
                            resolvedBase
                        );
                    }
                } else if (lastCompositionException != null) {
                    issues.Add(new ValidationIssue(
                        "$",
                        null,
                        "CompositionResolutionFailed",
                        "error",
                        $"Composition resolution failed: {lastCompositionException.Message}",
                        "Verify $include paths and fragment structure in profile and parent directories."
                    ));
                }
            }

            if (issues.Count > 0) {
                Log.Warning(
                    "SettingsEditorHub.ReadSettingsCore completed with issues: {FilePath}, IssueCount={IssueCount}",
                    filePath,
                    issues.Count
                );
                return HubResult.Failure<SettingsReadData>(
                    EnvelopeCode.WithErrors,
                    "Settings file read with errors.",
                    issues
                ) with { Data = new SettingsReadData(rawJson, resolvedJson, compositionMetadata) };
            }

            Log.Information(
                "SettingsEditorHub.ReadSettingsCore succeeded: {FilePath}, RawChars={RawChars}, ResolvedChars={ResolvedChars}",
                filePath,
                rawJson.Length,
                resolvedJson.Length
            );
            return HubResult.Success(
                new SettingsReadData(rawJson, resolvedJson, compositionMetadata),
                EnvelopeCode.Ok,
                "Settings file read."
            );
        });

    private async Task<HubResult<object?>> WriteSettingsCore(WriteSettingsRequest request) =>
        await this._taskQueue.EnqueueAsync(uiApp => {
            var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
            var settingsDir = module.SettingsDir();
            var issues = new List<ValidationIssue>();
            string filePath;
            try {
                filePath = settingsDir.ResolveSafeRelativeJsonPath(request.RelativePath);
            } catch (ArgumentException ex) {
                return HubResult.Failure<object?>(
                    EnvelopeCode.Failed,
                    "Invalid relative path.",
                    [
                        new ValidationIssue(
                            "$",
                            null,
                            "InvalidRelativePath",
                            "error",
                            ex.Message,
                            "Provide a valid relative path under the settings root."
                        )
                    ]
                );
            }

            if (request.Validate) {
                try {
                    var type = module.SettingsType;
                    var schema = JsonSchemaFactory.CreateAuthoringSchema(type, out var processor);
                    processor.Finalize(schema);

                    var validationErrors = schema.Validate(request.Json);
                    issues.AddRange(ValidationIssueMapper.ToValidationIssues(validationErrors));

                    if (issues.Count > 0)
                        return HubResult.Failure<object?>(
                            EnvelopeCode.Failed,
                            "Settings write failed validation.",
                            issues
                        );
                } catch (Exception ex) {
                    return HubResult.Failure<object?>(
                        EnvelopeCode.Exception,
                        $"Validation failed: {ex.Message}",
                        [
                            new ValidationIssue(
                                "$",
                                null,
                                "ValidationException",
                                "error",
                                $"Validation failed: {ex.Message}",
                                "Ensure payload is valid JSON for this module settings contract."
                            )
                        ]
                    );
                }
            }

            try {
                var fileDirectoryPath = Path.GetDirectoryName(filePath);
                if (!string.IsNullOrWhiteSpace(fileDirectoryPath))
                    _ = Directory.CreateDirectory(fileDirectoryPath);
                File.WriteAllText(filePath, request.Json);
                return HubResult.Success<object?>(
                    null,
                    EnvelopeCode.Ok,
                    "Settings file written."
                );
            } catch (Exception ex) {
                return HubResult.Failure<object?>(
                    EnvelopeCode.Failed,
                    $"Write failed: {ex.Message}",
                    [
                        new ValidationIssue(
                            "$",
                            null,
                            "WriteFailed",
                            "error",
                            $"Write failed: {ex.Message}",
                                "Check file permissions and storage path."
                        )
                    ]
                );
            }
        });

    private static PropertyInfo? ResolveProperty(Type type, string propertyPath) {
        var parts = propertyPath.Split('.');
        PropertyInfo? property = null;
        var currentType = type;

        foreach (var part in parts) {
            if (part == "items") {
                if (currentType.IsGenericType)
                    currentType = currentType.GetGenericArguments()[0];

                continue;
            }

            property = currentType.GetProperty(part,
                BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase);
            if (property == null) {
                Log.Debug("ResolveProperty: Property '{Part}' not found on type '{CurrentType}'", part,
                    currentType.Name);
                return null;
            }

            currentType = property.PropertyType;

            if (currentType.IsGenericType && currentType.GetGenericTypeDefinition() == typeof(List<>))
                currentType = currentType.GetGenericArguments()[0];
        }

        return property;
    }

    private static HashSet<string> ParseSelectedFamilyNames(IReadOnlyDictionary<string, string>? siblingValues) {
        if (siblingValues == null ||
            !siblingValues.TryGetValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
    }

    private static HashSet<Guid> LoadApsParameterGuids() {
        try {
            var cache = Pe.Global.Services.Storage.Storage.GlobalDir()
                .StateJson<ParametersApi.Parameters>("parameters-service-cache")
                as JsonReader<ParametersApi.Parameters>;
            if (cache == null || !File.Exists(cache.FilePath))
                return [];

            var results = cache.Read().Results;
            if (results == null)
                return [];

            var guids = new HashSet<Guid>();
            foreach (var param in results) {
                try { _ = guids.Add(param.DownloadOptions.GetGuid()); } catch {
                    // Skip entries with unparseable GUIDs.
                }
            }
            return guids;
        } catch {
            return [];
        }
    }

    private static string BuildThrottleKey(
        string? connectionId,
        string endpoint,
        string moduleKey,
        string? propertyPath,
        IReadOnlyDictionary<string, string>? siblingValues
    ) {
        var siblingSignature = siblingValues == null || siblingValues.Count == 0
            ? string.Empty
            : string.Join(
                "&",
                siblingValues
                    .OrderBy(pair => pair.Key, StringComparer.Ordinal)
                    .Select(pair => $"{pair.Key}={pair.Value}")
            );
        return $"{connectionId ?? "no-connection"}:{endpoint}:{moduleKey}:{propertyPath ?? string.Empty}:{siblingSignature}";
    }

    private static void LogThrottleDecision(
        string endpoint,
        ThrottleDecision decision,
        string moduleKey,
        string? propertyPath
    ) {
        if (decision == ThrottleDecision.CacheHit) {
            Log.Debug(
                "Throttle cache hit: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
            return;
        }

        if (decision == ThrottleDecision.Coalesced)
            Log.Debug(
                "Throttle coalesced request: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
    }

    private static List<string> BuildCompositionBaseCandidates(string primaryBasePath, string settingsRootPath) {
        var candidates = new List<string>();

        static string NormalizePath(string path) =>
            Path.GetFullPath(path)
                .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

        static void AddCandidate(ICollection<string> list, string? candidate) {
            if (string.IsNullOrWhiteSpace(candidate))
                return;

            var full = NormalizePath(candidate);
            if (!list.Contains(full, StringComparer.OrdinalIgnoreCase))
                list.Add(full);
        }

        var normalizedRoot = NormalizePath(settingsRootPath);
        AddCandidate(candidates, primaryBasePath);

        var current = NormalizePath(primaryBasePath);
        while (!string.Equals(current, normalizedRoot, StringComparison.OrdinalIgnoreCase)) {
            var parent = Directory.GetParent(current)?.FullName;
            if (string.IsNullOrWhiteSpace(parent))
                break;

            AddCandidate(candidates, parent);
            current = NormalizePath(parent);
        }

        AddCandidate(candidates, normalizedRoot);
        return candidates;
    }

    private static SettingsDirectoryTreeNode MapDirectoryTree(SettingsDirectoryNode node) =>
        new(
            node.Name,
            node.RelativePath,
            node.Directories.Select(MapDirectoryTree).ToList(),
            node.Files.Select(file => new SettingsFileTreeNode(
                file.Name,
                file.RelativePath,
                file.RelativePathWithoutExtension,
                file.Id,
                file.ModifiedUtc,
                file.IsFragment,
                file.IsSchema
            )).ToList()
        );
}
