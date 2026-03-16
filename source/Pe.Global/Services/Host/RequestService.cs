using Pe.StorageRuntime.Json;
using Pe.Global.Services.Document;
using Pe.Host.Contracts;
using Pe.StorageRuntime.Capabilities;
using Pe.StorageRuntime.Documents;
using Pe.StorageRuntime.Json.FieldOptions;
using Pe.StorageRuntime.Json.SchemaDefinitions;
using Pe.StorageRuntime.Revit.Core.Json;
using Pe.StorageRuntime.Revit.Core.Json.SchemaProviders;
using Pe.StorageRuntime.Revit.Context;
using Pe.StorageRuntime.Revit.Modules;
using Pe.StorageRuntime.Revit.Validation;
using ricaun.Revit.UI.Tasks;
using Serilog;
using System.Collections.Concurrent;
using RuntimeSettingsDocumentId = Pe.StorageRuntime.Documents.SettingsDocumentId;
using RuntimeSettingsValidationIssue = Pe.StorageRuntime.Documents.SettingsValidationIssue;

namespace Pe.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly IRevitContextAccessor _revitContextAccessor = new DocumentManagerRevitContextAccessor();
    private readonly RevitTaskService _revitTaskService;
    private readonly ConcurrentDictionary<string, SchemaData> _schemaCache = new(StringComparer.OrdinalIgnoreCase);
    private readonly ThrottleGate _throttleGate;

    private readonly ConcurrentDictionary<string, ISettingsDocumentValidator> _validationValidatorCache =
        new(StringComparer.OrdinalIgnoreCase);

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
        Log.Information("Settings editor request starting: Method={Method}, ModuleKey={ModuleKey}",
            nameof(this.GetSchemaEnvelopeAsync), request.ModuleKey);
        var result = await this.GetSchemaCore(request);
        Log.Information(
            "Settings editor request completed: Method={Method}, ModuleKey={ModuleKey}, Ok={Ok}, Code={Code}, ElapsedMs={ElapsedMs}",
            nameof(this.GetSchemaEnvelopeAsync),
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
        LogThrottleDecision(nameof(this.GetFieldOptionsEnvelopeAsync), decision, request.ModuleKey,
            request.PropertyPath);
        return response;
    }

    public async Task<ValidationEnvelopeResponse> ValidateSettingsEnvelopeAsync(ValidateSettingsRequest request) {
        var stopwatch = Stopwatch.StartNew();
        Log.Information(
            "Settings editor request starting: Method={Method}, ModuleKey={ModuleKey}, PayloadLength={PayloadLength}",
            nameof(this.ValidateSettingsEnvelopeAsync), request.ModuleKey, request.SettingsJson?.Length ?? 0);
        var result = await this.ValidateSettingsCore(request);
        Log.Information(
            "Settings editor request completed: Method={Method}, ModuleKey={ModuleKey}, Ok={Ok}, Code={Code}, ElapsedMs={ElapsedMs}",
            nameof(this.ValidateSettingsEnvelopeAsync),
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
        LogThrottleDecision(nameof(this.GetParameterCatalogEnvelopeAsync), decision, request.ModuleKey, null);
        return response;
    }

    private async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        await this.EnqueueAsync(() => {
            try {
                var providerContext = this.CreateFieldOptionsContext(request.ContextValues);
                var doc = providerContext.GetActiveDocument();
                if (doc == null) {
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
                }

                var entries = ParameterCatalogOptionFactory.Build(providerContext)
                    .Select(ToHostParameterCatalogEntry)
                    .ToList();

                var familyCount = entries.SelectMany(e => e.FamilyNames).Distinct(StringComparer.OrdinalIgnoreCase)
                    .Count();
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
                        "Ensure module registration, schema definitions, and type bindings are valid."
                    )
                ]
            );
        }
    }

    private async Task<Result<ValidationData>> ValidateSettingsCore(ValidateSettingsRequest request) {
        try {
            var module = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey);
            var validator = this._validationValidatorCache.TryGetValue(module.ModuleKey, out var cachedValidator)
                ? cachedValidator
                : await this.EnqueueAsync(() => this.GetOrCreateValidationValidator(module));
            var validation = await Task.Run(() => validator.Validate(
                new RuntimeSettingsDocumentId(module.ModuleKey, module.DefaultSubDirectory, "__bridge_validation__"),
                request.SettingsJson,
                null
            ));
            var issues = validation.Issues.Select(ToHostValidationIssue).ToList();
            var issueCount = issues.Count;

            return Result.Success(
                new ValidationData(validation.IsValid, issues),
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
            ) with {
                Data = new ValidationData(false, issues)
            };
        }
    }

    private async Task<Result<FieldOptionsData>> GetFieldOptionsCore(FieldOptionsRequest request) =>
        await this.EnqueueAsync(() => {
            try {
                var type = this._moduleRegistry.ResolveByModuleKey(request.ModuleKey).SettingsType;
                var property = SettingsPropertyPathResolver.ResolveProperty(type, request.PropertyPath);

                if (property == null)
                    return EmptyFieldOptions(request.SourceKey, "Property not found for field options provider.");

                var fieldOptions = SettingsFieldOptionsService.Shared.GetOptionsAsync(
                        type,
                        request.PropertyPath,
                        request.SourceKey,
                        this.CreateFieldOptionsContext(request.ContextValues)
                    )
                    .AsTask()
                    .GetAwaiter()
                    .GetResult();

                if (fieldOptions.Kind == FieldOptionsResultKind.Empty)
                    return EmptyFieldOptions(request.SourceKey, fieldOptions.Message);

                if (fieldOptions.Kind == FieldOptionsResultKind.Unsupported) {
                    return Result.Failure<FieldOptionsData>(
                        EnvelopeCode.Failed,
                        fieldOptions.Message,
                        [
                            new ValidationIssue(
                                "$",
                                null,
                                "FieldOptionsUnsupported",
                                "error",
                                fieldOptions.Message,
                                "Check active document state and runtime capability availability."
                            )
                        ]
                    ) with {
                        Data = EmptyFieldOptionsData(request.SourceKey)
                    };
                }

                if (fieldOptions.Kind == FieldOptionsResultKind.Failure) {
                    return Result.Failure<FieldOptionsData>(
                        EnvelopeCode.Failed,
                        fieldOptions.Message,
                        [
                            new ValidationIssue(
                                "$",
                                null,
                                "FieldOptionsException",
                                "error",
                                fieldOptions.Message,
                                "Check field option source configuration and request path."
                            )
                        ]
                    ) with {
                        Data = EmptyFieldOptionsData(request.SourceKey)
                    };
                }

                return Result.Success(
                    new FieldOptionsData(
                        request.SourceKey,
                        FieldOptionsMode.Suggestion,
                        true,
                        fieldOptions.Items.Select(ToFieldOptionItem).ToList()
                    ),
                    EnvelopeCode.Ok,
                    fieldOptions.Message
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
                ) with {
                    Data = EmptyFieldOptionsData(request.SourceKey)
                };
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
        var generatedSchemaData = RevitJsonSchemaFactory.CreateEditorSchemaData(
            type,
            SettingsRuntimeCapabilityProfiles.LiveDocument,
            this._revitContextAccessor
        );

        if (generatedSchemaData.FragmentSchemaJson == null) {
            Log.Warning(
                "Fragment schema generation failed: ModuleKey={ModuleKey}, SettingsType={SettingsType}",
                module.ModuleKey,
                type.FullName ?? type.Name
            );
        }

        var generatedSchema = new SchemaData(
            generatedSchemaData.SchemaJson,
            generatedSchemaData.FragmentSchemaJson
        );
        _ = this._schemaCache.TryAdd(module.ModuleKey, generatedSchema);
        return generatedSchema;
    }

    private ISettingsDocumentValidator GetOrCreateValidationValidator(ISettingsModule module) {
        if (this._validationValidatorCache.TryGetValue(module.ModuleKey, out var cachedValidator))
            return cachedValidator;

        var validator = new SchemaBackedSettingsDocumentValidator(
            module.SettingsType,
            SettingsRuntimeCapabilityProfiles.RevitAssemblyOnly
        );
        _ = this._validationValidatorCache.TryAdd(module.ModuleKey, validator);
        return validator;
    }

    private static FieldOptionsData EmptyFieldOptionsData(string sourceKey) =>
        new(
            sourceKey,
            FieldOptionsMode.Suggestion,
            true,
            []
        );

    private FieldOptionsExecutionContext CreateFieldOptionsContext(
        IReadOnlyDictionary<string, string>? contextValues = null
    ) => new(
        SettingsRuntimeCapabilityProfiles.LiveDocument,
        this._revitContextAccessor,
        contextValues
    );

    private static ParameterCatalogEntry ToHostParameterCatalogEntry(ParameterCatalogOption entry) =>
        new(
            entry.Name,
            entry.StorageType,
            entry.DataType,
            entry.IsShared,
            entry.IsInstance,
            entry.IsBuiltIn,
            entry.IsProjectParameter,
            entry.IsParamService,
            entry.SharedGuid,
            entry.FamilyNames,
            entry.TypeNames
        );

    private static Pe.Host.Contracts.FieldOptionItem ToFieldOptionItem(
        Pe.StorageRuntime.Json.FieldOptions.FieldOptionItem item
    ) => new(
            item.Value,
            item.Label,
            item.Description
        );

    private static ValidationIssue ToHostValidationIssue(RuntimeSettingsValidationIssue issue) =>
        new(
            issue.Path,
            null,
            issue.Code,
            issue.Severity,
            issue.Message,
            issue.Suggestion
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
        return
            $"{connectionId ?? "no-connection"}:{endpoint}:{moduleKey}:{propertyPath ?? string.Empty}:{siblingSignature}";
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

        if (decision == ThrottleDecision.Coalesced) {
            Log.Debug(
                "Throttle coalesced request: Endpoint={Endpoint}, ModuleKey={ModuleKey}, PropertyPath={PropertyPath}",
                endpoint,
                moduleKey,
                propertyPath
            );
        }
    }
}
