using Pe.Global.Services.Storage.Core.Json;
using Pe.Global.Services.Storage.Core.Json.SchemaProcessors;
using Pe.Global.Services.Storage.Core.Json.SchemaProviders;
using Pe.Global.Services.Storage.Modules;
using NJsonSchema;
using Serilog;
using System.Reflection;
using Pe.Host.Contracts;
using System.Collections.Concurrent;
using System.Diagnostics;
using Pe.Global.Services.Document;
using ricaun.Revit.UI.Tasks;

namespace Pe.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly ConcurrentDictionary<string, SchemaData> _schemaCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ThrottleGate _throttleGate;
    private readonly ConcurrentDictionary<string, JsonSchema> _validationSchemaCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly RevitTaskService _revitTaskService;

    public RequestService(
        RevitTaskService revitTaskService,
        SettingsModuleRegistry moduleRegistry,
        ThrottleGate throttleGate
    ) {
        this._revitTaskService = revitTaskService;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
    }

    public async Task<SchemaEnvelopeResponse> GetSchemaEnvelopeAsync(SchemaRequest request) {
        var stopwatch = Stopwatch.StartNew();
        Log.Information("Settings editor request starting: Method={Method}, ModuleKey={ModuleKey}", nameof(GetSchemaEnvelopeAsync), request.ModuleKey);
        var result = await this.GetSchemaCore(request);
        Log.Information(
            "Settings editor request completed: Method={Method}, ModuleKey={ModuleKey}, Ok={Ok}, Code={Code}, ElapsedMs={ElapsedMs}",
            nameof(GetSchemaEnvelopeAsync),
            request.ModuleKey,
            result.Ok,
            result.Code,
            stopwatch.ElapsedMilliseconds
        );
        return result.ToSchemaEnvelope();
    }

    public async Task<FieldOptionsEnvelopeResponse> GetFieldOptionsEnvelopeAsync(
        FieldOptionsRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "field-options",
            request.ModuleKey,
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            async () => {
                var result = await this.GetFieldOptionsCore(request);
                return new FieldOptionsEnvelopeResponse(
                    result.Ok,
                    result.Code,
                    result.Message,
                    result.Issues,
                    result.Data
                );
            }
        );
        LogThrottleDecision(nameof(GetFieldOptionsEnvelopeAsync), decision, request.ModuleKey, request.PropertyPath);
        return response;
    }

    public async Task<ValidationEnvelopeResponse> ValidateSettingsEnvelopeAsync(ValidateSettingsRequest request) {
        var stopwatch = Stopwatch.StartNew();
        Log.Information("Settings editor request starting: Method={Method}, ModuleKey={ModuleKey}, PayloadLength={PayloadLength}", nameof(ValidateSettingsEnvelopeAsync), request.ModuleKey, request.SettingsJson?.Length ?? 0);
        var result = await this.ValidateSettingsCore(request);
        Log.Information(
            "Settings editor request completed: Method={Method}, ModuleKey={ModuleKey}, Ok={Ok}, Code={Code}, ElapsedMs={ElapsedMs}",
            nameof(ValidateSettingsEnvelopeAsync),
            request.ModuleKey,
            result.Ok,
            result.Code,
            stopwatch.ElapsedMilliseconds
        );
        return result.ToValidationEnvelope();
    }

    public async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogEnvelopeAsync(
        ParameterCatalogRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "parameter-catalog",
            request.ModuleKey,
            null,
            request.ContextValues
        );
        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            ParameterCatalogThrottleWindow,
            () => this.GetParameterCatalogCore(request)
        );
        LogThrottleDecision(nameof(GetParameterCatalogEnvelopeAsync), decision, request.ModuleKey, null);
        return response;
    }

    private async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        await this.EnqueueAsync(() => {
            try {
                var doc = DocumentManager.GetActiveDocument();
                if (doc == null)
                    return Result
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

                var selectedFamilies = ParseSelectedFamilyNames(request.ContextValues);
                var entries = ParameterCatalogOptionFactory.Build(selectedFamilies);

                var familyCount = entries.SelectMany(e => e.FamilyNames).Distinct(StringComparer.OrdinalIgnoreCase).Count();
                var typeCount = entries.SelectMany(e => e.TypeNames).Distinct(StringComparer.Ordinal).Count();

                return Result
                    .Success(
                        new ParameterCatalogData(entries, familyCount, typeCount),
                        EnvelopeCode.Ok,
                        $"Collected {entries.Count} parameter entries across {familyCount} families."
                    )
                    .ToParameterCatalogEnvelope();
            } catch (Exception ex) {
                return Result
                    .Failure<ParameterCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            Result.ExceptionIssue(
                                "ParameterCatalogException",
                                ex,
                                "Verify selected families and active document state."
                            )
                        ]
                    )
                    .ToParameterCatalogEnvelope();
            }
        });

    private async Task<Result<SchemaData>> GetSchemaCore(SchemaRequest request) {
        try {
            var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
            if (this._schemaCache.TryGetValue(module.ModuleKey, out var cachedSchema))
                return Result.Success(cachedSchema, EnvelopeCode.Ok, "Schema loaded from cache.");

        var schemaData = await this.EnqueueAsync(() => this.GetOrCreateSchemaData(module));
            return Result.Success(schemaData, EnvelopeCode.Ok, "Schema generated.");
        } catch (Exception ex) {
            return Result.Failure<SchemaData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    Result.ExceptionIssue(
                        "SchemaException",
                        ex,
                        "Ensure module registration and schema processors are valid."
                    )
                ]
            );
        }
    }

    private async Task<Result<ValidationData>> ValidateSettingsCore(ValidateSettingsRequest request) {
        try {
            var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
            var schema = this._validationSchemaCache.TryGetValue(module.ModuleKey, out var cachedSchema)
                ? cachedSchema
                : await this.EnqueueAsync(() => this.GetOrCreateValidationSchema(module));

            var issues = await Task.Run(() =>
                    ValidationIssueMapper.ToValidationIssues(schema.Validate(request.SettingsJson)).ToList()
                );
            var issueCount = issues.Count;

            return Result.Success(
                new ValidationData(issueCount == 0, issues),
                EnvelopeCode.Ok,
                issueCount == 0 ? "Validation passed." : "Validation returned issues.",
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
            return Result.Failure<ValidationData>(
                EnvelopeCode.Failed,
                ex.Message,
                issues
            ) with { Data = new ValidationData(false, issues) };
        }
    }

    private async Task<Result<FieldOptionsData>> GetFieldOptionsCore(FieldOptionsRequest request) =>
        await this.EnqueueAsync(() => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var property = ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return EmptyFieldOptions(request.SourceKey, "Property not found for field options provider.");

                var providerAttr = property.GetCustomAttribute<SchemaExamplesAttribute>();
                if (providerAttr == null)
                    return EmptyFieldOptions(request.SourceKey, "No field options provider configured for property.");

                if (!string.Equals(providerAttr.ProviderType.Name, request.SourceKey, StringComparison.Ordinal))
                    return EmptyFieldOptions(request.SourceKey, "Requested field options source does not match property provider.");

                var provider = Activator.CreateInstance(providerAttr.ProviderType) as IOptionsProvider;
                if (provider == null)
                    return Result.Failure<FieldOptionsData>(
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
                    ) with { Data = EmptyFieldOptionsData(request.SourceKey) };

                var items = ResolveFieldOptionItems(provider, request.ContextValues);

                return Result.Success(
                    new FieldOptionsData(
                        request.SourceKey,
                        FieldOptionsMode.Suggestion,
                        true,
                        items
                    ),
                    EnvelopeCode.Ok,
                    $"Retrieved {items.Count} field options."
                );
            } catch (Exception ex) {
                Log.Error(ex, "GetFieldOptions failed for property '{PropertyPath}'", request.PropertyPath);
                return Result.Failure<FieldOptionsData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        Result.ExceptionIssue(
                            "FieldOptionsException",
                            ex,
                            "Check provider configuration and request path."
                        )
                    ]
                ) with { Data = EmptyFieldOptionsData(request.SourceKey) };
            }
        });

    private async Task<T> EnqueueAsync<T>(Func<T> action) {
        var queueStopwatch = Stopwatch.StartNew();
        Log.Information("Settings editor request queue starting: ResultType={ResultType}", typeof(T).Name);
        T? result = default;
        _ = await this._revitTaskService.Run(async () => {
            Log.Information(
                "Settings editor request queue running on Revit thread after {ElapsedMs} ms: ResultType={ResultType}",
                queueStopwatch.ElapsedMilliseconds,
                typeof(T).Name
            );
            result = action();
            await Task.CompletedTask;
        });
        Log.Information(
            "Settings editor request queue completed in {ElapsedMs} ms: ResultType={ResultType}",
            queueStopwatch.ElapsedMilliseconds,
            typeof(T).Name
        );
        return result!;
    }

    private static Result<FieldOptionsData> EmptyFieldOptions(string sourceKey, string message) =>
        Result.Success(
            EmptyFieldOptionsData(sourceKey),
            EnvelopeCode.Ok,
            message
        );

    private SchemaData GetOrCreateSchemaData(ISettingsModule module) {
        if (this._schemaCache.TryGetValue(module.ModuleKey, out var cachedSchema))
            return cachedSchema;

        var type = module.SettingsType;
        var targetSchemaJson = JsonSchemaFactory.CreateRenderSchemaJson(type, out _, resolveExamples: false);

        string? fragmentSchemaJson = null;
        try {
            var fragmentSchema = JsonSchemaFactory.CreateFragmentSchema(type, out var fragProcessor, resolveExamples: false);
            fragProcessor.Finalize(fragmentSchema);
            fragmentSchemaJson = RenderSchemaTransformer.TransformFragmentToJson(fragmentSchema, type);
        } catch (Exception ex) {
            Log.Warning(
                ex,
                "Fragment schema generation failed: ModuleKey={ModuleKey}, SettingsType={SettingsType}",
                module.ModuleKey,
                type.FullName ?? type.Name
            );
        }

        var generatedSchema = new SchemaData(targetSchemaJson, fragmentSchemaJson);
        _ = this._schemaCache.TryAdd(module.ModuleKey, generatedSchema);
        return generatedSchema;
    }

    private JsonSchema GetOrCreateValidationSchema(ISettingsModule module) {
        if (this._validationSchemaCache.TryGetValue(module.ModuleKey, out var cachedSchema))
            return cachedSchema;

        var schema = JsonSchemaFactory.CreateAuthoringSchema(module.SettingsType, out _, resolveExamples: false);
        _ = this._validationSchemaCache.TryAdd(module.ModuleKey, schema);
        return schema;
    }

    private static FieldOptionsData EmptyFieldOptionsData(string sourceKey) =>
        new(
            sourceKey,
            FieldOptionsMode.Suggestion,
            true,
            []
        );

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

    private static HashSet<string> ParseSelectedFamilyNames(IReadOnlyDictionary<string, string>? contextValues) {
        if (contextValues == null ||
            !contextValues.TryGetValue(OptionContextKeys.SelectedFamilyNames, out var rawFamilyNames))
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        return ProjectFamilyParameterCollector.ParseDelimitedFamilyNames(rawFamilyNames);
    }

    private static List<FieldOptionItem> ResolveFieldOptionItems(
        IOptionsProvider provider,
        IReadOnlyDictionary<string, string>? contextValues
    ) {
        if (provider is IDependentOptionsProvider dependentProvider &&
            contextValues is { Count: > 0 })
            return dependentProvider
                .GetExamples(contextValues)
                .Select(ToFieldOptionItem)
                .ToList();

        return provider
            .GetExamples()
            .Select(ToFieldOptionItem)
            .ToList();
    }

    private static FieldOptionItem ToFieldOptionItem(string value) =>
        new(
            Value: value,
            Label: value,
            Description: null
        );

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
}
