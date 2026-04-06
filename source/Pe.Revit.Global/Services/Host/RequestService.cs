using Pe.Shared.HostContracts.RevitData;
using Pe.Shared.HostContracts.SettingsStorage;
using Pe.Revit.Global.Revit.Lib.Parameters;
using Pe.Revit.Global.Services.Document;
using Pe.Shared.StorageRuntime.Capabilities;
using Pe.Shared.StorageRuntime.Context;
using Pe.Shared.StorageRuntime.Json.FieldOptions;
using Pe.Shared.StorageRuntime.Json.SchemaDefinitions;
using Pe.Shared.StorageRuntime.Core.Json.SchemaProviders;
using Pe.Shared.StorageRuntime.Modules;
using ricaun.Revit.UI.Tasks;
using Serilog;
using FieldOptionItem = Pe.Shared.HostContracts.SettingsStorage.FieldOptionItem;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Revit-aware host operations served through the bridge.
/// </summary>
public class RequestService {
    private static readonly TimeSpan FieldOptionsThrottleWindow = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan ParameterCatalogThrottleWindow = TimeSpan.FromMilliseconds(750);

    private readonly SettingsModuleRegistry _moduleRegistry;
    private readonly ISettingsDocumentContextAccessor _documentContextAccessor = new DocumentManagerRevitContextAccessor();
    private readonly RevitTaskService _revitTaskService;
    private readonly ThrottleGate _throttleGate;

    public RequestService(
        RevitTaskService revitTaskService,
        SettingsModuleRegistry moduleRegistry,
        ThrottleGate throttleGate
    ) {
        this._revitTaskService = revitTaskService;
        this._moduleRegistry = moduleRegistry;
        this._throttleGate = throttleGate;
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

    public async Task<FieldOptionsEnvelopeResponse> GetLoadedFamiliesFilterFieldOptionsEnvelopeAsync(
        LoadedFamiliesFilterFieldOptionsRequest request,
        string? connectionId = null
    ) {
        var key = BuildThrottleKey(
            connectionId,
            "loaded-families-filter-field-options",
            nameof(LoadedFamiliesFilter),
            $"{request.PropertyPath}:{request.SourceKey}",
            request.ContextValues
        );

        var (response, decision) = await this._throttleGate.ExecuteAsync(
            key,
            FieldOptionsThrottleWindow,
            async () => {
                var result = await this.GetLoadedFamiliesFilterFieldOptionsCore(request);
                return result.ToFieldOptionsEnvelope();
            }
        );
        LogThrottleDecision(
            nameof(this.GetLoadedFamiliesFilterFieldOptionsEnvelopeAsync),
            decision,
            nameof(LoadedFamiliesFilter),
            request.PropertyPath
        );
        return response;
    }

    private async Task<ParameterCatalogEnvelopeResponse> GetParameterCatalogCore(ParameterCatalogRequest request) =>
        await this.EnqueueAsync(() => {
            try {
                var providerContext = this.CreateFieldOptionsContext(request.ContextValues);
                var doc = providerContext.GetActiveDocument<Autodesk.Revit.DB.Document>();
                if (doc == null) {
                    return HostEnvelopeResults
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

                return HostEnvelopeResults
                    .Success(
                        new ParameterCatalogData(entries, familyCount, typeCount),
                        EnvelopeCode.Ok,
                        $"Collected {entries.Count} parameter entries across {familyCount} families."
                    )
                    .ToParameterCatalogEnvelope();
            } catch (Exception ex) {
                return HostEnvelopeResults
                    .Failure<ParameterCatalogData>(
                        EnvelopeCode.Failed,
                        ex.Message,
                        [
                            HostEnvelopeResults.ExceptionIssue(
                                "ParameterCatalogException",
                                ex,
                                "Verify selected families and active document state."
                            )
                        ]
                    )
                    .ToParameterCatalogEnvelope();
            }
        });

    private async Task<HostEnvelopeResult<FieldOptionsData>> GetLoadedFamiliesFilterFieldOptionsCore(
        LoadedFamiliesFilterFieldOptionsRequest request
    ) => await this.EnqueueAsync(() => {
        try {
            var fieldOptions = SettingsFieldOptionsService.Shared.GetOptionsAsync(
                    typeof(LoadedFamiliesFilter),
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
                return HostEnvelopeResults.Failure<FieldOptionsData>(
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
                return HostEnvelopeResults.Failure<FieldOptionsData>(
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

            return HostEnvelopeResults.Success(
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
            Log.Error(
                ex,
                "GetLoadedFamiliesFilterFieldOptions failed for property '{PropertyPath}'",
                request.PropertyPath
            );
            return HostEnvelopeResults.Failure<FieldOptionsData>(
                EnvelopeCode.Failed,
                ex.Message,
                [
                    HostEnvelopeResults.ExceptionIssue(
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

    private async Task<HostEnvelopeResult<FieldOptionsData>> GetFieldOptionsCore(FieldOptionsRequest request) =>
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
                    return HostEnvelopeResults.Failure<FieldOptionsData>(
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
                    return HostEnvelopeResults.Failure<FieldOptionsData>(
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

                return HostEnvelopeResults.Success(
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
                return HostEnvelopeResults.Failure<FieldOptionsData>(
                    EnvelopeCode.Failed,
                    ex.Message,
                    [
                        HostEnvelopeResults.ExceptionIssue(
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

    private static HostEnvelopeResult<FieldOptionsData> EmptyFieldOptions(string sourceKey, string message) =>
        HostEnvelopeResults.Success(
            EmptyFieldOptionsData(sourceKey),
            EnvelopeCode.Ok,
            message
        );

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
        SettingsRuntimeMode.LiveDocument,
        this._documentContextAccessor,
        contextValues
    );

    private static ParameterCatalogEntry ToHostParameterCatalogEntry(ParameterCatalogOption entry) =>
        new(
            ParameterIdentityEngine.FromCanonical(entry.Identity),
            entry.StorageType,
            entry.DataType,
            entry.IsInstance,
            entry.IsParamService,
            entry.FamilyNames,
            entry.TypeNames
        );

    private static FieldOptionItem ToFieldOptionItem(
        Shared.StorageRuntime.Json.FieldOptions.FieldOptionItem item
    ) => new(
        item.Value,
        item.Label,
        item.Description
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
